// إعادة تفعيل مفتاح kie المعلم exhausted (يُعاد تعليمه تلقائيًا لو الرصيد نفد فعلًا)
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^TURSO_DATABASE_URL=(.+)$/m)?.[1]?.trim();
const token = env.match(/^TURSO_AUTH_TOKEN=(.+)$/m)?.[1]?.trim();
const db = createClient({ url, authToken: token });

const before = await db.execute("SELECT id, provider, status, fail_count, last_error FROM api_keys");
console.log("قبل:", before.rows.map(r => `${r.provider}:${r.status}`).join(", "));

await db.execute("UPDATE api_keys SET status = 'active', last_error = NULL WHERE status = 'exhausted'");

const after = await db.execute("SELECT id, provider, status FROM api_keys");
console.log("بعد:", after.rows.map(r => `${r.provider}:${r.status}`).join(", "));
