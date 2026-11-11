// إدخال المفاتيح الجديدة في جدول api_keys — بفحص تكرار — بلا طباعة أي مفتاح كاملًا
// الاستخدام: K_OR=... K_CFUT=... K_BLOB=... node scripts/add-keys.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { createClient } = require("@libsql/client");
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const KEYS = [
  { provider: "openrouter", label: "OpenRouter — صور وفيديو (النماذج المدفوعة تتطلب رصيد حساب)", api_key: process.env.K_OR, status: "active" },
  { provider: "pollinations", label: "Pollinations — مفتاح مجاني تلقائي للصور (بلا مفتاح نهائيًا)", api_key: "FREE-NO-KEY-REQUIRED", status: "active" },
  { provider: "cloudflare", label: "Cloudflare API Token — صالح لكن بلا صلاحيات Account/Workers AI — معطّل حتى استكمال الصلاحيات أو تزويد معرّف الحساب", api_key: process.env.K_CFUT, status: "disabled" },
  { provider: "unknown", label: "مفتاح مجهول المصدر (بيانات ثنائية 115 بايت) — رفضه kie و Google و cometapi", api_key: process.env.K_BLOB, status: "disabled" },
];

const mask = (s) => (s ? String(s).slice(0, 8) + "…" + String(s).slice(-4) : "null");
for (const k of KEYS) {
  if (!k.api_key) { console.log("SKIP_EMPTY:", k.provider); continue; }
  const dup = await db.execute({ sql: "SELECT id, status FROM api_keys WHERE api_key = ?", args: [k.api_key] });
  if (dup.rows.length) {
    console.log("SKIP_DUP:", k.provider, String(dup.rows[0].id), "status:", String(dup.rows[0].status));
    continue;
  }
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key, status) VALUES (?, ?, ?, ?, ?)`,
    args: [id, k.provider, k.label, k.api_key, k.status],
  });
  console.log("INSERTED:", JSON.stringify({ id, provider: k.provider, key: mask(k.api_key), status: k.status, label: k.label.slice(0, 60) }));
}
console.log("DONE");
