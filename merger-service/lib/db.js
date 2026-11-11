// =============================================================================
// طبقة قاعدة البيانات — Turso (libSQL): المهام، المصادر، أجزاء المصادر، أجزاء الناتج
// كل شيء في Turso — لا S3 ولا خدمات خارجية. إنشاء الجداول عند أول وصول.
// =============================================================================
const { createClient } = require("@libsql/client");

// تحميل .env يدويًا (بدون تبعيات)
function loadEnvFile() {
  const fs = require("fs");
  const path = require("path");
  for (const f of [".env", ".env.local"]) {
    const p = path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvFile();

let _db = null;
let _schema = null;

function db() {
  if (!_db) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      throw new Error("متغيرات البيئة TURSO_DATABASE_URL و TURSO_AUTH_TOKEN إلزاميان");
    }
    _db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _db;
}

async function ensureSchema() {
  if (!_schema) {
    _schema = (async () => {
      await db().execute(`CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        sources_count INTEGER DEFAULT 0,
        output_size INTEGER,
        output_duration REAL,
        output_resolution TEXT,
        video_url TEXT,
        download_url TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      )`);
      await db().execute(`CREATE TABLE IF NOT EXISTS sources (
        job_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        url TEXT,
        name TEXT,
        mime TEXT,
        size INTEGER,
        received INTEGER DEFAULT 0,
        PRIMARY KEY (job_id, seq)
      )`);
      await db().execute(`CREATE TABLE IF NOT EXISTS source_chunks (
        job_id TEXT NOT NULL,
        source_seq INTEGER NOT NULL,
        row_index INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (job_id, source_seq, row_index)
      )`);
      await db().execute(`CREATE TABLE IF NOT EXISTS output_chunks (
        job_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (job_id, row_index)
      )`);
    })().catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// --- المهام -------------------------------------------------------------------
async function insertJob(job) {
  await ensureSchema();
  await db().execute({
    sql: `INSERT INTO jobs (id, status, sources_count, expires_at) VALUES (?, ?, ?, ?)`,
    args: [job.id, job.status, job.sourcesCount, job.expiresAt],
  });
}

async function getJob(id) {
  await ensureSchema();
  const rs = await db().execute({ sql: `SELECT * FROM jobs WHERE id = ?`, args: [id] });
  return rs.rows[0] ?? null;
}

async function updateJob(id, patch) {
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    args.push(v);
  }
  if (!sets.length) return;
  args.push(id);
  await db().execute({ sql: `UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, args });
}

async function deleteJobCascade(id) {
  await ensureSchema();
  await db().batch([
    { sql: `DELETE FROM jobs WHERE id = ?`, args: [id] },
    { sql: `DELETE FROM sources WHERE job_id = ?`, args: [id] },
    { sql: `DELETE FROM source_chunks WHERE job_id = ?`, args: [id] },
    { sql: `DELETE FROM output_chunks WHERE job_id = ?`, args: [id] },
  ], "write");
}

/** تنظيف كسول للمهام المنتهية (expires_at < now) — يُستدعى عند الإنشاء/الدمج + /api/cron */
async function deleteExpiredJobs() {
  await ensureSchema();
  const rs = await db().execute({ sql: `SELECT id FROM jobs WHERE expires_at < datetime('now')`, args: [] });
  if (!rs.rows.length) return 0;
  const ids = rs.rows.map((r) => String(r.id));
  await db().batch(
    ids.flatMap((id) => [
      { sql: `DELETE FROM jobs WHERE id = ?`, args: [id] },
      { sql: `DELETE FROM sources WHERE job_id = ?`, args: [id] },
      { sql: `DELETE FROM source_chunks WHERE job_id = ?`, args: [id] },
      { sql: `DELETE FROM output_chunks WHERE job_id = ?`, args: [id] },
    ]),
    "write"
  );
  return ids.length;
}

// --- المصادر -------------------------------------------------------------------
async function insertSource(s) {
  await db().execute({
    sql: `INSERT INTO sources (job_id, seq, kind, url, name, mime, size, received) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [s.jobId, s.seq, s.kind, s.url ?? null, s.name ?? null, s.mime ?? null, s.size ?? null, 0],
  });
}

async function listSources(jobId) {
  const rs = await db().execute({ sql: `SELECT * FROM sources WHERE job_id = ? ORDER BY seq ASC`, args: [jobId] });
  return rs.rows.map((r) => ({
    jobId: String(r.job_id), seq: Number(r.seq), kind: String(r.kind),
    url: r.url ? String(r.url) : null, name: r.name ? String(r.name) : null,
    mime: r.mime ? String(r.mime) : null, size: r.size !== null ? Number(r.size) : null,
    received: Number(r.received ?? 0),
  }));
}

async function updateSourceReceived(jobId, seq, received) {
  await db().execute({ sql: `UPDATE sources SET received = ? WHERE job_id = ? AND seq = ?`, args: [received, jobId, seq] });
}

module.exports = {
  db, ensureSchema, insertJob, getJob, updateJob, deleteJobCascade, deleteExpiredJobs,
  insertSource, listSources, updateSourceReceived,
};
