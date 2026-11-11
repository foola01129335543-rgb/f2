// جولة ثالثة: هل inkling على AR يولّد صورًا؟ هل النماذج المجانية تعمل؟ UAA مرشحون آخرون
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);

const K = {
  ar1: process.env.K_AR1 || "",
  uaa: process.env.K_UAA || "",
};

const j = async (url, opts = {}, t = 45000) => {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(t) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 250); }
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: String(e?.message ?? e).slice(0, 120) }; }
};

// 1) AR: نموذج حر نصّي — هل يعمل مجانًا؟
{
  const r = await j("https://api.anyrouter.dev/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${K.ar1}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openrouter/free", messages: [{ role: "user", content: "قل: تم" }], max_tokens: 10 }),
  }, 60000);
  console.log("AR_FREE_TEXT:", JSON.stringify({ status: r.status,
    content: String(r.body?.choices?.[0]?.message?.content ?? "").slice(0, 60),
    err: JSON.stringify(r.body?.error ?? null).slice(0, 200) }));
}

// 2) AR: inkling-small — صورة تجريبية
{
  const r = await j("https://api.anyrouter.dev/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${K.ar1}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "thinkingmachines/inkling-small", messages: [{ role: "user", content: "Generate an image of a tiny red apple on a white background" }] }),
  }, 120000);
  const msg = r.body?.choices?.[0]?.message ?? {};
  console.log("AR_INKLING:", JSON.stringify({ status: r.status,
    hasImages: Array.isArray(msg.images) && msg.images.length > 0,
    contentType: typeof msg.content,
    contentHead: String(msg.content ?? "").slice(0, 120),
    err: JSON.stringify(r.body?.error ?? r.body).slice(0, 300) }));
}

// 3) AR: كاتالوج — بحث موسّع عن فيديو
{
  const raw = readFileSync("/tmp/ar-models.txt", "utf8").split("\n").filter(Boolean);
  const kw = /omni|avatar|motion|animate|clip|cinem|frame|heygen|cog|hunyuan|magi|pixverse|vidu|kling|wan|seedance|hailuo|sora|veo|video|reel|scene|ltx|mochi|movie/i;
  console.log("AR_VIDEOISH:", JSON.stringify(raw.filter((i) => kw.test(i)).slice(0, 40)));
}

// 4) UAA — مرشحون آخرون بصيغ مصادقة مختلفة
const altProbes = [
  ["bfl-xkey", { url: "https://api.bfl.ai/v1/get_result?id=00000000-0000-0000-0000-000000000000", headers: { "x-key": K.uaa } }],
  ["baseten-apikey", { url: "https://api.baseten.co/models/active", headers: { Authorization: `Api-Key ${K.uaa}` } }],
  ["recraft", { url: "https://api.recraft.ai/v1/models", headers: { Authorization: `Bearer ${K.uaa}` } }],
  ["vidu-real", { url: "https://api.vidu.com/ent/v2/tasks?page_num=0&page_size=1", headers: { Authorization: `Bearer ${K.uaa}`, "Content-Type": "application/json" } }],
  ["ideogram", { url: "https://api.ideogram.ai/v1/users/me", headers: { Authorization: `Bearer ${K.uaa}` } }],
  ["openart", { url: "https://api.openart.ai/api/v1/me", headers: { Authorization: `Bearer ${K.uaa}` } }],
];
for (const [name, p] of altProbes) {
  const r = await j(p.url, { headers: p.headers });
  console.log("UAA_ALT:", JSON.stringify({ name, status: r.status, head: JSON.stringify(r.body).slice(0, 160) }));
}
// tensor.art — مساراته عبر docs-json إن وجدت
{
  const r = await j("https://api.tensor.art/docs-json", {});
  const paths = r.body?.paths ? Object.keys(r.body.paths).slice(0, 30) : null;
  console.log("TENSOR_DOCS:", JSON.stringify({ status: r.status, paths }));
}
console.log("DONE");
