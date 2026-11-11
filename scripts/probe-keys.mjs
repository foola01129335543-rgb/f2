// فحص المفاتيح الثلاثة الجديدة — لا يطبع أي مفتاح كاملًا
// الاستخدام: K_CFUT=... K_OR=... K_BLOB=... node scripts/probe-keys.mjs
const K = {
  cfut: process.env.K_CFUT || "",
  or: process.env.K_OR || "",
  blob: process.env.K_BLOB || "",
};

const mask = (s) => (s ? String(s).slice(0, 8) + "…" + String(s).slice(-4) : "(فارغ)");
console.log("KEYS:", JSON.stringify({ cfut: mask(K.cfut), or: mask(K.or), blob: mask(K.blob) }));

const j = async (url, opts = {}, t = 20000) => {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(t) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: String(e?.message ?? e) }; }
};

// قراءة .env.local لمفتاح kie القديم ومفتاح google الحالي
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
let googleKey = null;
try {
  const { createClient } = require("@libsql/client");
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const rs = await db.execute(`SELECT api_key FROM api_keys WHERE provider='google' LIMIT 1`);
  if (rs.rows.length) googleKey = String(rs.rows[0].api_key);
} catch (e) { console.log("DB-ERR:", String(e).slice(0, 120)); }

// 1) فك base64 للمفتاح الثالث (هل هو مفتاح مغلف؟)
try {
  const dec = Buffer.from(K.blob, "base64");
  const printable = dec.every((b) => b >= 32 && b < 127);
  console.log("BLOB_DECODE:", JSON.stringify({
    bytes: dec.length, printable,
    ascii_head: printable ? dec.toString("utf8").slice(0, 100) : null,
    hex_head: dec.toString("hex").slice(0, 32),
  }));
} catch (e) { console.log("BLOB_DECODE_ERR:", String(e).slice(0, 100)); }

// 2) OpenRouter — الصلاحية والرصيد
const orKey = await j("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${K.or}` } });
console.log("OPENROUTER_KEY:", JSON.stringify(orKey).slice(0, 600));

// نماذج الفيديو المتاحة + الأسعار
const vm = await j("https://openrouter.ai/api/v1/videos/models");
const vlist = (vm.body?.data ?? []).map((m) => ({
  id: m.id, durations: m.supported_durations, res: m.supported_resolutions,
  ar: m.supported_aspect_ratios, pricing: m.pricing_skus,
}));
console.log("OPENROUTER_VIDEO_MODELS_COUNT:", vlist.length);
for (const m of vlist) console.log("VMODEL:", JSON.stringify(m));

// نماذج الصور (أول 25)
const im = await j("https://openrouter.ai/api/v1/images/models");
console.log("OPENROUTER_IMAGE_MODELS_COUNT:", im.body?.data?.length ?? 0);
for (const m of (im.body?.data ?? []).slice(0, 25)) console.log("IMODEL:", m.id);

// 3) Cloudflare — الصلاحية + الحساب + نماذج Workers AI
const cfv = await j("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { Authorization: `Bearer ${K.cfut}` } });
console.log("CF_VERIFY:", JSON.stringify({ status: cfv.status, success: cfv.body?.success, errors: cfv.body?.errors, result: cfv.body?.result }));
const accs = await j("https://api.cloudflare.com/client/v4/accounts", { headers: { Authorization: `Bearer ${K.cfut}` } });
const accList = accs.body?.result?.map((a) => ({ id: a.id, name: a.name })) ?? [];
console.log("CF_ACCOUNTS:", JSON.stringify({ status: accs.status, ok: accs.body?.success, errors: accs.body?.errors, accounts: accList }));
const accId = accList[0]?.id;
if (accId) {
  const ai = await j(`https://api.cloudflare.com/client/v4/accounts/${accId}/ai/models/search?per_page=200`, { headers: { Authorization: `Bearer ${K.cfut}` } });
  const interesting = (ai.body?.result ?? [])
    .filter((m) => /video|flux|schnell|diffusion|image|img/i.test(`${m.name} ${m.task?.name ?? ""}`))
    .map((m) => ({ name: m.name, task: m.task?.name ?? null }));
  console.log("CF_AI_MODELS:", JSON.stringify({ status: ai.status, ok: ai.body?.success, errors: ai.body?.errors, matches: interesting }));
}

// 4) kie.ai — فحص رصيد لكل مفتاح مرشح
for (const [name, key] of [["kie-old", env.KIE_API_KEY], ["cfut", K.cfut], ["blob", K.blob], ["or", K.or]]) {
  if (!key) continue;
  const r = await j("https://api.kie.ai/api/v1/chat/credit", { headers: { Authorization: `Bearer ${key}` } });
  console.log("KIE_CREDIT:", JSON.stringify({ who: name, status: r.status, body: r.body }));
}

// 5) Google — المفتاح الثالث والمفتاح AQ الحالي عبر x-goog-api-key
for (const [name, key] of [["blob", K.blob], ["google-aq", googleKey]]) {
  if (!key) continue;
  const r = await j("https://generativelanguage.googleapis.com/v1beta/models?pageSize=5", { headers: { "x-goog-api-key": key } });
  console.log("GOOGLE_MODELS:", JSON.stringify({ who: name, status: r.status, head: JSON.stringify(r.body).slice(0, 220) }));
}

// 6) cometapi — فحص المفتاح الثالث
const cbase = "https://api.cometapi.com";
for (const [name, key] of [["blob", K.blob], ["cfut", K.cfut]]) {
  if (!key) continue;
  const r = await j(`${cbase}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
  console.log("COMETAPI_MODELS:", JSON.stringify({ who: name, status: r.status, head: JSON.stringify(r.body).slice(0, 160) }));
}

console.log("DONE");
