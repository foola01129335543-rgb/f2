// فحص مفصّل: المفاتيح مع last_error + المهام المعلقة بمعرّفاتها الكاملة و attempts_json
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const { createClient } = require("@libsql/client");
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const mask = (s) => (s ? String(s).slice(0, 8) + "…" + String(s).slice(-4) : "null");

console.log("=== المفاتيح (مع آخر خطأ) ===");
const keys = await db.execute("SELECT * FROM api_keys ORDER BY created_at ASC");
for (const r of keys.rows) {
  console.log(JSON.stringify({
    id: String(r.id), provider: String(r.provider), label: String(r.label),
    key: mask(r.api_key), status: String(r.status),
    last_error: r.last_error ? String(r.last_error).slice(0, 300) : null,
    last_used: r.last_used_at ? String(r.last_used_at) : null,
  }));
}

console.log("\n=== المهام غير المكتملة (معرّفات كاملة + محاولات) ===");
const tasks = await db.execute(`
  SELECT id, type, model, provider, provider_task_id, status, progress, error_message, attempts_json, prompt, created_at
  FROM tasks WHERE status NOT IN ('succeeded','failed') ORDER BY created_at ASC
`);
for (const r of tasks.rows) {
  let attempts = [];
  try { attempts = JSON.parse(String(r.attempts_json ?? "[]")); } catch {}
  const compact = attempts.slice(-3).map((a) => `${a.provider}/${(a.keyLabel || a.keyId || "?").toString().slice(0, 20)}:${a.ok ? "OK" : (a.error || a.errorClass || "FAIL").toString().slice(0, 120)}`);
  console.log(JSON.stringify({
    id: String(r.id),
    type: String(r.type), model: String(r.model), status: String(r.status), progress: Number(r.progress),
    provider: r.provider ? String(r.provider) : null, ptask: r.provider_task_id ? String(r.provider_task_id) : null,
    prompt: String(r.prompt ?? "").slice(0, 90),
    err: r.error_message ? String(r.error_message).slice(0, 120) : null,
    last_attempts: compact,
    created: String(r.created_at),
  }));
}
console.log("\nTOTAL_STUCK:", tasks.rows.length);
