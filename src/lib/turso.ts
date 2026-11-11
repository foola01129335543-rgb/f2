// =============================================================================
// طبقة قاعدة البيانات — Turso (libSQL) عبر HTTP
// قرار: عميل واحد مُعاد استخدامه + ensureSchema ذاكرةً (بلا أدوات migrations)
// حتى يبقى المشروع متوافقًا تمامًا مع بيئة Vercel الـ serverless (لا ملفات محلية).
// =============================================================================
import { createClient, type Client, type InValue } from "@libsql/client";

let _client: Client | null = null;
let _schemaPromise: Promise<void> | null = null;

export function getDb(): Client {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
  }
  return _client;
}

// --- الأنواع المطابقة لمخطط المواصفة -----------------------------------------
export interface TaskRow {
  id: string;
  provider: string | null;
  provider_task_id: string | null;
  key_id: string | null;
  model: string;
  type: "image" | "video" | "merge";
  prompt: string;
  params_json: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  result_urls_json: string | null;
  error_message: string | null;
  attempts_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AttemptRecord {
  provider: string;
  keyId: string;
  keyLabel?: string;
  ok: boolean;
  errorClass?: string;
  error?: string;
  at: string;
}

export interface KeyRow {
  id: string;
  provider: "kie" | "cometapi" | "google";
  label: string;
  api_key: string;
  status: "active" | "exhausted" | "disabled";
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

// --- المخطط ------------------------------------------------------------------
export async function ensureSchema(): Promise<void> {
  if (!_schemaPromise) {
    _schemaPromise = (async () => {
      const db = getDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        provider TEXT,
        provider_task_id TEXT,
        key_id TEXT,
        model TEXT NOT NULL,
        type TEXT NOT NULL,
        prompt TEXT DEFAULT '',
        params_json TEXT DEFAULT '{}',
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        result_urls_json TEXT,
        error_message TEXT,
        attempts_json TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      )`);
      await db.execute(`CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT DEFAULT '',
        api_key TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        usage_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        last_used_at TEXT,
        last_checked_at TEXT,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      // وسائط مولّدة محليًا (صور مزود Google تعود base64) — تُخدَّم عبر /api/media/[id]
      await db.execute(`CREATE TABLE IF NOT EXISTS media_blobs (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        bytes INTEGER DEFAULT 0,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
    })().catch((err) => {
      // نُصفّي الوعد عند الفشل حتى تُعاد المحاولة في الطلب التالي
      _schemaPromise = null;
      throw err;
    });
  }
  return _schemaPromise;
}

export async function dbHealthy(): Promise<boolean> {
  try {
    await ensureSchema();
    const rs = await getDb().execute("SELECT 1");
    return rs.rows.length > 0;
  } catch {
    return false;
  }
}

// --- عمليات المهام -------------------------------------------------------------
function mapTask(row: Record<string, unknown>): TaskRow {
  return {
    id: String(row.id),
    provider: (row.provider as string) ?? null,
    provider_task_id: (row.provider_task_id as string) ?? null,
    key_id: (row.key_id as string) ?? null,
    model: String(row.model),
    type: row.type as TaskRow["type"],
    prompt: String(row.prompt ?? ""),
    params_json: String(row.params_json ?? "{}"),
    status: row.status as TaskRow["status"],
    progress: Number(row.progress ?? 0),
    result_urls_json: (row.result_urls_json as string) ?? null,
    error_message: (row.error_message as string) ?? null,
    attempts_json: String(row.attempts_json ?? "[]"),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    completed_at: (row.completed_at as string) ?? null,
  };
}

export async function insertTask(t: {
  id: string;
  provider?: string | null;
  provider_task_id?: string | null;
  key_id?: string | null;
  model: string;
  type: TaskRow["type"];
  prompt?: string;
  params_json?: string;
  status?: TaskRow["status"];
  error_message?: string | null;
}): Promise<TaskRow> {
  await ensureSchema();
  const rs = await getDb().execute({
    sql: `INSERT INTO tasks (id, provider, provider_task_id, key_id, model, type, prompt, params_json, status, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      t.id,
      t.provider ?? null,
      t.provider_task_id ?? null,
      t.key_id ?? null,
      t.model,
      t.type,
      t.prompt ?? "",
      t.params_json ?? "{}",
      t.status ?? "processing",
      t.error_message ?? null,
    ] satisfies InValue[],
  });
  if (rs.rowsAffected !== 1) throw new Error("فشل إدراج المهمة في قاعدة البيانات");
  return (await getTask(t.id))!;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  await ensureSchema();
  const rs = await getDb().execute({ sql: "SELECT * FROM tasks WHERE id = ?", args: [id] });
  return rs.rows.length ? mapTask(rs.rows[0] as unknown as Record<string, unknown>) : null;
}

/** تحديث جزئي للمهمة + تسجيل المحاولة في attempts_json + ضبط completed_at تلقائيًا */
export async function updateTask(
  id: string,
  patch: Partial<Pick<TaskRow,
    "provider" | "provider_task_id" | "key_id" | "status" | "progress" |
    "result_urls_json" | "error_message" | "model" | "prompt">>,
  attempt?: AttemptRecord
): Promise<TaskRow | null> {
  await ensureSchema();
  const current = await getTask(id);
  if (!current) return null;

  const sets: string[] = ["updated_at = datetime('now')"];
  const args: InValue[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    args.push(v as InValue);
  }
  if (patch.status === "completed") sets.push("completed_at = COALESCE(completed_at, datetime('now'))");
  if (patch.status === "completed") sets.push("progress = 100");

  if (attempt) {
    const attempts: AttemptRecord[] = safeParse<AttemptRecord[]>(current.attempts_json, []);
    attempts.push(attempt);
    sets.push("attempts_json = ?");
    args.push(JSON.stringify(attempts));
  }

  args.push(id);
  await getDb().execute({ sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, args });
  return await getTask(id);
}

export async function listRecentTasks(
  limit = 20,
  filter?: { type?: TaskRow["type"]; status?: TaskRow["status"] }
): Promise<TaskRow[]> {
  await ensureSchema();
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter?.type) { where.push("type = ?"); args.push(filter.type); }
  if (filter?.status) { where.push("status = ?"); args.push(filter.status); }
  args.push(Math.min(Math.max(limit, 1), 50));
  const rs = await getDb().execute({
    sql: `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id DESC LIMIT ?`,
    args,
  });
  return rs.rows.map((r) => mapTask(r as unknown as Record<string, unknown>));
}

export interface TaskStats {
  total: number; completed: number; failed: number; processing: number;
}

export async function taskStats(): Promise<TaskStats> {
  await ensureSchema();
  const rs = await getDb().execute(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status='processing' OR status='pending' THEN 1 ELSE 0 END) AS processing
     FROM tasks`
  );
  const r = rs.rows[0] ?? {};
  return {
    total: Number(r.total ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
    processing: Number(r.processing ?? 0),
  };
}

/** حذف مهام (لتنظيف آثار الاختبار أو المهام القديمة) */
export async function deleteTasks(ids: string[]): Promise<number> {
  await ensureSchema();
  if (!ids.length) return 0;
  const rs = await getDb().execute({
    sql: `DELETE FROM tasks WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  return rs.rowsAffected;
}

// --- عمليات المفاتيح -----------------------------------------------------------
export async function listKeys(): Promise<KeyRow[]> {
  await ensureSchema();
  const rs = await getDb().execute("SELECT * FROM api_keys ORDER BY created_at ASC, id ASC");
  return rs.rows.map((r) => mapKey(r as unknown as Record<string, unknown>));
}

/** مجمع المفاتيح: الترتيب التسلسلي الصارم حسب الإضافة (created_at ASC, id ASC) — ليس round-robin */
export async function getKeyPool(providers: Array<"kie" | "cometapi" | "google">): Promise<KeyRow[]> {
  await ensureSchema();
  if (!providers.length) return [];
  const placeholders = providers.map(() => "?").join(",");
  const rs = await getDb().execute({
    sql: `SELECT * FROM api_keys
          WHERE status != 'disabled' AND provider IN (${placeholders})
          ORDER BY created_at ASC, id ASC`,
    args: providers as InValue[],
  });
  return rs.rows.map((r) => mapKey(r as unknown as Record<string, unknown>));
}

export async function insertKey(k: {
  id: string; provider: "kie" | "cometapi" | "google"; label?: string; api_key: string;
}): Promise<KeyRow> {
  await ensureSchema();
  await getDb().execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key) VALUES (?, ?, ?, ?)`,
    args: [k.id, k.provider, k.label ?? "", k.api_key],
  });
  const rs = await getDb().execute({ sql: "SELECT * FROM api_keys WHERE id = ?", args: [k.id] });
  return mapKey(rs.rows[0] as unknown as Record<string, unknown>);
}

export async function getKey(id: string): Promise<KeyRow | null> {
  await ensureSchema();
  const rs = await getDb().execute({ sql: "SELECT * FROM api_keys WHERE id = ?", args: [id] });
  return rs.rows.length ? mapKey(rs.rows[0] as unknown as Record<string, unknown>) : null;
}

export async function setKeyStatus(id: string, status: KeyRow["status"], lastError?: string | null): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE api_keys SET status = ?, last_error = COALESCE(?, last_error), last_checked_at = datetime('now') WHERE id = ?`,
    args: [status, lastError ?? null, id],
  });
}

/** تحديث عدّادات المفتاح بعد كل محاولة (استخدام/نجاح/فشل) */
export async function bumpKeyCounters(id: string, ok: boolean, error?: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE api_keys SET
            usage_count = usage_count + 1,
            success_count = success_count + ?,
            fail_count = fail_count + ?,
            last_used_at = datetime('now'),
            last_checked_at = datetime('now'),
            last_error = COALESCE(?, last_error)
          WHERE id = ?`,
    args: [ok ? 1 : 0, ok ? 0 : 1, ok ? null : (error ?? null), id],
  });
}

export async function deleteKey(id: string): Promise<boolean> {
  await ensureSchema();
  const rs = await getDb().execute({ sql: "DELETE FROM api_keys WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}

function mapKey(row: Record<string, unknown>): KeyRow {
  return {
    id: String(row.id),
    provider: row.provider as KeyRow["provider"],
    label: String(row.label ?? ""),
    api_key: String(row.api_key),
    status: row.status as KeyRow["status"],
    usage_count: Number(row.usage_count ?? 0),
    success_count: Number(row.success_count ?? 0),
    fail_count: Number(row.fail_count ?? 0),
    last_used_at: (row.last_used_at as string) ?? null,
    last_checked_at: (row.last_checked_at as string) ?? null,
    last_error: (row.last_error as string) ?? null,
    created_at: String(row.created_at ?? ""),
  };
}

// --- وسائط مولّدة (blobs) — صور مزود Google -------------------------------------------------
export async function insertMediaBlob(b: { id: string; mime: string; data: string }): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `INSERT INTO media_blobs (id, mime, bytes, data) VALUES (?, ?, ?, ?)`,
    args: [b.id, b.mime, Math.round((b.data.length * 3) / 4), b.data],
  });
}

export async function getMediaBlob(id: string): Promise<{ mime: string; data: string } | null> {
  await ensureSchema();
  const rs = await getDb().execute({
    sql: `SELECT mime, data FROM media_blobs WHERE id = ?`,
    args: [id],
  });
  if (!rs.rows.length) return null;
  return { mime: String(rs.rows[0].mime), data: String(rs.rows[0].data) };
}

// --- أدوات مساعدة ---------------------------------------------------------------
export function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
