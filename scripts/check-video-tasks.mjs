// فحص مهام الفيديو الأخيرة + حالة مفاتيح kie — بدون طباعة أي أسرار
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);

// قراءة .env.local يدويًا
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const { createClient } = require("@libsql/client");
const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

const mask = (s) => (s ? String(s).slice(0, 10) + "…" + String(s).slice(-4) : "null");

// 1) آخر 15 مهمة
const tasks = await db.execute(`
  SELECT id, type, model, provider, provider_task_id, key_id, status, progress,
         error_message, created_at, updated_at, completed_at
  FROM tasks ORDER BY created_at DESC LIMIT 15
`);
console.log("=== آخر المهام ===");
for (const r of tasks.rows) {
  console.log(JSON.stringify({
    id: String(r.id).slice(0, 8),
    type: String(r.type),
    model: String(r.model),
    provider: String(r.provider),
    ptask: r.provider_task_id ? String(r.provider_task_id) : null,
    status: String(r.status),
    progress: Number(r.progress),
    err: r.error_message ? String(r.error_message).slice(0, 160) : null,
    created: String(r.created_at), updated: String(r.updated_at),
  }));
}

// 2) حالة تجمع المفاتيح
const keys = await db.execute(`SELECT id, provider, label, api_key, status, usage_count, success_count, fail_count, last_used_at FROM api_keys ORDER BY id`);
console.log("\n=== تجمع المفاتيح ===");
for (const r of keys.rows) {
  console.log(JSON.stringify({
    id: String(r.id), provider: String(r.provider), label: String(r.label),
    key: mask(r.api_key), status: String(r.status),
    usage: Number(r.usage_count), ok: Number(r.success_count), fail: Number(r.fail_count),
    last: r.last_used_at ? String(r.last_used_at) : null,
  }));
}
