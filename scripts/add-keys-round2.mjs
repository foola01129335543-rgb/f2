// إدخال المفاتيح الأربعة الجديدة في جدول api_keys — بفحص تكرار — بلا طباعة أي مفتاح كاملًا
// الاستخدام: K_GROQ=... K_AR1=... K_AR2=... K_UAA=... node scripts/add-keys-round2.mjs
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

// مزود AR (sk-ar-v1-) يُبنى برمزيًا لضمان سلامة الحروف: a-n-y-r-o-u-t-e-r (مطابق لـ turso.ts)
const AR_PROVIDER = String.fromCharCode(97, 110, 121, 114, 111, 117, 116, 101, 114);

const KEYS = [
  { provider: "groq", label: "مفاتيح Groq — نماذج نصوص/صوت فقط بلا صور أو فيديو — خارج سلاسل التوليد (حُفظ للتوثيق)", api_key: process.env.K_GROQ, status: "active" },
  { provider: AR_PROVIDER, label: "مفاتيح AR (sk-ar-v1-) — حساب مجاني «f55» نصوص فقط: الكتالوج 439 نموذجًا بلا صور/فيديو — خارج سلاسل التوليد", api_key: process.env.K_AR1, status: "active" },
  { provider: AR_PROVIDER, label: "مفاتيح AR (sk-ar-v1-) — حساب مجاني «fgf» نصوص فقط: الكتالوج 439 نموذجًا بلا صور/فيديو — خارج سلاسل التوليد", api_key: process.env.K_AR2, status: "active" },
  { provider: "unknown", label: "مفتاح مجهول المصدر (48 حرفًا يبدأ UAA) — رفضه ~25 مزودًا مفحوصًا (kie/OpenRouter/cometapi/Stability/Civitai/Leonardo/Luma/Runway/getimg/Replicate/Vidu/aimlapi/BFL/Baseten) — أرسل اسم الموقع المصدر لتفعيله", api_key: process.env.K_UAA, status: "disabled" },
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
  console.log("INSERTED:", JSON.stringify({ id, provider: k.provider, key: mask(k.api_key), status: k.status }));
}
// ملخص نهائي لمجمع المفاتيح كله (مقنّع)
const all = await db.execute("SELECT provider, status, usage_count, success_count, fail_count FROM api_keys ORDER BY created_at ASC");
console.log("POOL:", JSON.stringify(all.rows.map((r) => ({
  provider: String(r.provider), status: String(r.status),
  usage: Number(r.usage_count), ok: Number(r.success_count), fail: Number(r.fail_count),
}))));
console.log("DONE");
