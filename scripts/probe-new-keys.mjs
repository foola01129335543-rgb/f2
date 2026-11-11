// فحص المفاتيح الأربعة الجديدة + بدائل نماذج الفيديو على kie — بلا طباعة أي مفتاح كاملًا
// الاستخدام: K_GROQ=... K_AR1=... K_AR2=... K_UAA=... node scripts/probe-new-keys.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);

const K = {
  groq: process.env.K_GROQ || "",
  ar1: process.env.K_AR1 || "",
  ar2: process.env.K_AR2 || "",
  uaa: process.env.K_UAA || "",
};
const mask = (s) => (s ? String(s).slice(0, 8) + "…" + String(s).slice(-4) : "(فارغ)");
console.log("KEYS:", JSON.stringify({ groq: mask(K.groq), ar1: mask(K.ar1), ar2: mask(K.ar2), uaa: mask(K.uaa) }));

const j = async (url, opts = {}, t = 25000) => {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(t) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: String(e?.message ?? e).slice(0, 120) }; }
};

// env + DB (للحصول على برومبت مهمة فيديو عالقة + مفتاح kie القديم)
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { createClient } = require("@libsql/client");
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
let kieKey = env.KIE_API_KEY || "";
let stuck = null;
{
  const ks = await db.execute(`SELECT api_key FROM api_keys WHERE provider='kie' LIMIT 1`);
  if (ks.rows.length) kieKey = String(ks.rows[0].api_key);
  const ts = await db.execute(`SELECT id, prompt, params_json FROM tasks WHERE type='video' AND status='processing' ORDER BY created_at DESC LIMIT 1`);
  if (ts.rows.length) stuck = ts.rows[0];
  console.log("KIE_KEY:", mask(kieKey), "| STUCK:", stuck ? String(stuck.id).slice(0, 8) : "none",
    "| PROMPT:", stuck ? String(stuck.prompt).slice(0, 80) : "-");
}

// 1) Groq — هل فيه نماذج صور/فيديو؟
{
  const r = await j("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${K.groq}` } });
  const ids = (r.body?.data ?? []).map((m) => m.id);
  console.log("GROQ:", JSON.stringify({ status: r.status, count: ids.length,
    mediaish: ids.filter((i) => /image|img|flux|video|tts|whisper|guard|vision/i.test(i)) }));
}

// 2) مفتاحا sk-ar-v1- — هما مفتاحا صلاحية لـ OpenRouter كذلك؟
for (const [n, key] of [["ar1", K.ar1], ["ar2", K.ar2]]) {
  const or = await j("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${key}` } });
  console.log("IS_OPENROUTER?", JSON.stringify({ who: n, status: or.status }));
}

// 3) مفتاحا sk-ar-v1- لدى AnyRouter — الرصيد والفئات المتاحة
for (const [n, key] of [["ar1", K.ar1], ["ar2", K.ar2]]) {
  const info = await j("https://api.anyrouter.dev/api/v1/auth/key", { headers: { Authorization: `Bearer ${key}` } })
    .catch(() => ({ status: 0, body: null }));
  const info2 = await j("https://anyrouter.dev/api/v1/auth/key", { headers: { Authorization: `Bearer ${key}` } });
  console.log("ANYROUTER_AUTH:", JSON.stringify({ who: n,
    api_status: info.status, body: JSON.stringify(info.body).slice(0, 300),
    www_status: info2.status, www_body: JSON.stringify(info2.body).slice(0, 300) }));
  const models = await j("https://api.anyrouter.dev/api/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  const models2 = await j("https://anyrouter.dev/api/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  const pick = (b) => (b?.data ?? b?.models ?? []).map((m) => m.id ?? m.name ?? String(m));
  const all = pick(models.body).concat(pick(models2.body));
  console.log("ANYROUTER_MODELS:", JSON.stringify({ who: n, status: [models.status, models2.status],
    total: all.length,
    media: all.filter((i) => /image|img|flux|banana|imagen|dall|seedream|seedance|video|sora|veo|imagine|kling|wan|sd[0-9]|diffusion|photo|picture|canvas|poster/i.test(i)).slice(0, 40),
    free: all.filter((i) => /free/i.test(i)).slice(0, 20) }));
}

// 4) مفتاح UAA — بطارية مزودين مرشحين
const probes = [
  ["civitai", "https://civitai.com/api/v1/me", {}],
  ["stability", "https://api.stability.ai/v1/user/account", {}],
  ["leonardo", "https://cloud.leonardo.ai/api/rest/v1/me", {}],
  ["luma", "https://api.lumalabs.ai/dream-machine/v1/generations?limit=1", {}],
  ["runway", "https://api.dev.runwayml.com/v1/organization", { "X-Runway-Version": "2024-11-06" }],
  ["getimg", "https://api.getimg.ai/v1/models", {}],
  ["baseten", "https://api.baseten.co/models/active", {}],
  ["replicate", "https://api.replicate.com/v1/account", {}],
  ["kie", "https://api.kie.ai/api/v1/chat/credit", {}],
  ["openrouter", "https://openrouter.ai/api/v1/auth/key", {}],
  ["cometapi", "https://api.cometapi.com/v1/models", {}],
  ["vidu", "https://api.vidu.com/ent/v2/tasks?page_num=1&page_size=1", {}],
  ["tensorart", "https://api.tensor.art/openapi/api/v1/users/user-info", {}],
  ["aimlapi", "https://api.aimlapi.com/v1/models", {}],
];
for (const [name, url, extra] of probes) {
  const r = await j(url, { headers: { Authorization: `Bearer ${K.uaa}`, ...extra } });
  console.log("UAA_PROBE:", JSON.stringify({ name, status: r.status, head: JSON.stringify(r.body).slice(0, 180) }));
}

// 5) OpenRouter — النماذج المجانية للصور/الفيديو بمفتاح sk-or-v1 القديم
{
  const im = await j("https://openrouter.ai/api/v1/images/models");
  const rows = im.body?.data ?? [];
  console.log("OR_IMAGE_MODELS:", JSON.stringify({ status: im.status, count: rows.length,
    free: rows.filter((m) => /free/.test(m.id)).map((m) => m.id).slice(0, 20),
    cheap: rows.slice(0, 8).map((m) => ({ id: m.id, p: m.pricing })) }));
  const vm = await j("https://openrouter.ai/api/v1/videos/models");
  const vr = vm.body?.data ?? [];
  console.log("OR_VIDEO_MODELS:", JSON.stringify({ status: vm.status, count: vr.length,
    ids: vr.map((m) => m.id).slice(0, 15),
    free: vr.filter((m) => /free/.test(m.id)).map((m) => m.id) }));
}

// 6) kie — بدائل نماذج الفيديو: probe createTask ببرومبت المهمة العالقة (لو نجح مجانًا نربطها)
const kieCandidates = [
  "sora-2-text-to-video",
  "sora-2",
  "veo3_fast",
  "veo3-fast",
  "jimeng-seedance-1-0-pro-t2v",
  "jimeng-seedance-1-0-lite-t2v",
  "wan2-5-t2v-preview",
  "wan-2-5-t2v-preview",
  "hailuo-02-standard",
  "kling-v2-master",
  "pixverse-latest",
  "vidu-q1",
];
console.log("KIE_BALANCE:", JSON.stringify(
  (await j("https://api.kie.ai/api/v1/chat/credit", { headers: { Authorization: `Bearer ${kieKey}` } })).body));
if (stuck) {
  const input = JSON.parse(String(stuck.params_json ?? "{}"));
  if (input.prompt === undefined) input.prompt = String(stuck.prompt);
  for (const model of kieCandidates) {
    const r = await j("https://api.kie.ai/api/v1/jobs/createTask", {
      method: "POST",
      headers: { Authorization: `Bearer ${kieKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input, callBackUrl: "https://f2-brown.vercel.app/api/health" }),
    }, 30000);
    const ok = r.status === 200 && r.body?.code === 200;
    console.log("KIE_PROBE:", JSON.stringify({ model, status: r.status, code: r.body?.code,
      msg: String(r.body?.msg ?? "").slice(0, 100), taskId: ok ? r.body?.data : null }));
    if (ok) {
      // نجح مجانًا → نربط المهمة العالقة به فورًا ونتوقف عن التجربة على باقي النماذج
      await db.execute({
        sql: `UPDATE tasks SET provider='kie', provider_task_id=?, key_id=(SELECT id FROM api_keys WHERE provider='kie' LIMIT 1),
              status='processing', error_message=NULL, progress=5, updated_at=datetime('now') WHERE id=?`,
        args: [String(r.body.data), String(stuck.id)],
      });
      console.log("KIE_LINKED:", String(stuck.id).slice(0, 8), "→", model, "task", String(r.body.data).slice(0, 20));
      break;
    }
  }
}
console.log("DONE");
