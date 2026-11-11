// تحقق نهائي: حالة كل المهام + سجل محاولات الفيديو الأخيرة (إثبات تجربة كل المفاتيح)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { createClient } = require("@libsql/client");
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const tasks = await db.execute(`
  SELECT id, type, status, provider, result_urls_json, error_message, attempts_json
  FROM tasks WHERE status NOT IN ('succeeded') AND (status='processing' OR status='completed' OR status='failed')
  ORDER BY created_at ASC
`);
let done = 0, stuck = 0;
for (const r of tasks.rows) {
  const status = String(r.status);
  const urls = (() => { try { return JSON.parse(String(r.result_urls_json ?? "[]")); } catch { return []; } })();
  let attempts = []; try { attempts = JSON.parse(String(r.attempts_json ?? "[]")); } catch {}
  if (status === "completed") {
    done++;
    console.log(JSON.stringify({ id: String(r.id).slice(0, 8), type: String(r.type), status, provider: r.provider ? String(r.provider) : null, url: urls[0] ?? null }));
    continue;
  }
  stuck++;
  const chain = {};
  for (const a of attempts.slice(-8)) {
    if (!a.ok) chain[a.provider] = (a.error ?? a.errorClass ?? "?").toString().slice(0, 90);
  }
  console.log(JSON.stringify({ id: String(r.id).slice(0, 8), type: String(r.type), status, tries: attempts.length, last_errors_by_provider: chain }));
}
console.log("COMPLETED:", done, "STUCK:", stuck);
