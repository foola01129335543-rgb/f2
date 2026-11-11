// جولة فحص ثانية: صلاحية UAA على aimlapi، كاتالوج AR الكامل، إعادة groq
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
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

// 1) صلاحية UAA على aimlapi — مقارنة بمفتاح تالف
{
  const ok = await j("https://api.aimlapi.com/v1/models", { headers: { Authorization: `Bearer ${K.uaa}` } });
  const bad = await j("https://api.aimlapi.com/v1/models", { headers: { Authorization: `Bearer sk-garbage-invalid-key-000` } });
  const none = await j("https://api.aimlapi.com/v1/models");
  console.log("AIMLAPI_VALIDITY:", JSON.stringify({
    uaa: { status: ok.status, count: ok.body?.data?.length ?? null },
    garbage: { status: bad.status, count: bad.body?.data?.length ?? null },
    none: { status: none.status, count: none.body?.data?.length ?? null },
  }));
  // endpoint معلومات المفتاح/الرصيد إن وُجد
  for (const p of ["/v1/key/info", "/v1/subscription", "/v1/balance", "/v1/credits"]) {
    const r = await j(`https://api.aimlapi.com${p}`, { headers: { Authorization: `Bearer ${K.uaa}` } });
    if (r.status !== 404) console.log("AIMLAPI_INFO:", JSON.stringify({ p, status: r.status, head: JSON.stringify(r.body).slice(0, 200) }));
  }
  // نموذج صورة رخيص جدًا (flux/schnell) — إن كان المفتاح صالحًا سيكشف الرصيد
  const img = await j("https://api.aimlapi.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${K.uaa}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "flux/schnell", prompt: "a tiny red apple on white background", n: 1, size: "512x512" }),
  }, 60000);
  console.log("AIMLAPI_IMAGE_TEST:", JSON.stringify({ status: img.status, head: JSON.stringify(img.body).slice(0, 400) }));
}

// 2) كاتالوج AR الكامل — بحث شامل عن نماذج صور/فيديو
{
  const r = await j("https://api.anyrouter.dev/api/v1/models", { headers: { Authorization: `Bearer ${K.ar1}` } });
  const ids = (r.body?.data ?? []).map((m) => m.id ?? m.name).filter(Boolean);
  writeFileSync("/tmp/ar-models.txt", ids.join("\n"));
  console.log("AR_CATALOG:", JSON.stringify({ status: r.status, total: ids.length }));
  const kw = /image|img|flux|banana|imagen|dall|seedream|seedance|video|sora|veo|imagine|kling|wan[-_ ]?\d|sd3|sdxl|stable[-_ ]?diff|diffusion|photo|picture|canvas|poster|inkling|midjourney|hailuo|luma|runway|pika|vidu|pixverse|grok-imagine/i;
  const media = ids.filter((i) => kw.test(i));
  console.log("AR_MEDIA_HITS:", JSON.stringify({ count: media.length, ids: media.slice(0, 60) }));
}

// 3) groq إعادة
{
  const r = await j("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${K.groq}` } });
  console.log("GROQ_RETRY:", JSON.stringify({ status: r.status, head: JSON.stringify(r.body).slice(0, 300) }));
}
console.log("DONE");
