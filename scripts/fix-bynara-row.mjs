// تصحيح صف مفتاح Bynara المُدخل سابقًا بمزود خاطئ (kie) وبلا تسمية
// يعيّن provider=bynara + تسمية توثيقية + status exhausted (الرصيد المجاني منتهي 402)
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

const KEY = process.env.K_NRY || "";
const mask = (s) => String(s).slice(0, 8) + "…" + String(s).slice(-4);

// ابحث بالمفتاح نفسه (قد يكون السجل موجودًا بمزود خاطئ)
const rs = await db.execute({ sql: "SELECT id, provider, status FROM api_keys WHERE api_key = ?", args: [KEY] });
if (!rs.rows.length) { console.log("NOT_FOUND"); process.exit(1); }
const row = rs.rows[0];
console.log("BEFORE:", JSON.stringify({ id: String(row.id), provider: String(row.provider), status: String(row.status) }));

await db.execute({
  sql: `UPDATE api_keys
        SET provider = 'bynara',
            label = 'Bynara (router.bynara.id) — مفتاح صالح لكن نصوص فقط: الكتالوج 47 نموذجًا بلا صور/فيديو، والرصيد المجاني منتهي (402 Insufficient credits) — خارج سلاسل التوليد',
            status = 'exhausted'
        WHERE id = ?`,
  args: [String(row.id)],
});

const after = await db.execute({ sql: "SELECT id, provider, status, substr(label,1,80) AS label_head FROM api_keys WHERE id = ?", args: [String(row.id)] });
console.log("AFTER:", JSON.stringify({ id: String(after.rows[0].id), provider: String(after.rows[0].provider),
  status: String(after.rows[0].status), label_head: String(after.rows[0].label_head), key: mask(KEY) }));
console.log("DONE");
