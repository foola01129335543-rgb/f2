// إدخال مفتاح APInex (sk-apx-) في جدول api_keys — بفحص تكرار — بلا طباعة أي مفتاح كاملًا
// الاستخدام: K_APX=... node scripts/add-keys-round4.mjs
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
  { provider: "apinex",
    label: "APInex (api.apinex.bond) — المزود الأول للصور بدل kie: نموذج gpt-image-2.6-flare عبر /v1/images/generations — الحساب صالح، الرصيد $0 وخطة مجانية 15 RPM، الفيديو غير مدعوم لدى APInex — يتطلب شحنًا للتوليد الفعلي",
    api_key: process.env.K_APX, status: "active" },
];

const mask = (s) => (s ? String(s).slice(0, 8) + "…" + String(s).slice(-4) : "null");
for (const k of KEYS) {
  if (!k.api_key) { console.log("SKIP_EMPTY:", k.provider); continue; }
  const dup = await db.execute({ sql: "SELECT id, provider, status FROM api_keys WHERE api_key = ?", args: [k.api_key] });
  if (dup.rows.length) {
    console.log("SKIP_DUP:", k.provider, String(dup.rows[0].id), "provider:", String(dup.rows[0].provider), "status:", String(dup.rows[0].status));
    continue;
  }
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key, status) VALUES (?, ?, ?, ?, ?)`,
    args: [id, k.provider, k.label, k.api_key, k.status],
  });
  console.log("INSERTED:", JSON.stringify({ id, provider: k.provider, key: mask(k.api_key), status: k.status }));
}
console.log("DONE");
