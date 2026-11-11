// تنظيف آثار الاختبار (معيار القبول: نظّف آثار الاختبار بعد الانتهاء)
// - حذف مفتاح الاختبار المضاف من الواجهة
// - حذف مهام الاختبار من قاعدة البيانات (الصورة/الفيديو/المهمة الاصطناعية)
// - الاحتفاظ بالمفتاح الحقيقي بحالته الفعلية (مستنزف — الرصيد نفد أثناء الاختبارات)
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

// 1) حذف مفاتيح الاختبار (المفتاح الوهمي + مفتاح واجهة الاختبار)
const keys = await db.execute("SELECT id, label, api_key FROM api_keys");
const testKeys = keys.rows.filter(r =>
  String(r.api_key).includes("kie_invalid_test_key") || String(r.api_key).includes("test-ui-key")
);
for (const k of testKeys) {
  await db.execute({ sql: "DELETE FROM api_keys WHERE id = ?", args: [k.id] });
  console.log("deleted test key:", String(k.label).slice(0, 40));
}

// 2) حذف مهام الاختبار
const rs = await db.execute("DELETE FROM tasks");
console.log("deleted test tasks rows:", rs.rowsAffected);

// 3) حذف أي مهام دمج قديمة لدى خدمة الدمج إن وجدت
try {
  const jobs = await db.execute("SELECT id FROM jobs");
  for (const j of jobs.rows) {
    await db.execute({ sql: "DELETE FROM sources WHERE job_id = ?", args: [j.id] });
    await db.execute({ sql: "DELETE FROM source_chunks WHERE job_id = ?", args: [j.id] });
    await db.execute({ sql: "DELETE FROM output_chunks WHERE job_id = ?", args: [j.id] });
    await db.execute({ sql: "DELETE FROM jobs WHERE id = ?", args: [j.id] });
  }
  console.log("deleted merger jobs:", jobs.rows.length);
} catch { /* جداول الدمج قد لا تكون موجودة بعد */ }

// الحالة النهائية
const finalKeys = await db.execute("SELECT provider, status, label FROM api_keys ORDER BY created_at");
console.log("\nالمفاتيح المتبقية:");
for (const k of finalKeys.rows) console.log(` - ${k.provider} | ${k.status} | ${k.label}`);
const t = await db.execute("SELECT COUNT(*) AS c FROM tasks");
console.log("المهام المتبقية:", t.rows[0].c);
