// فحص المفتاح الجديد sk-nry-… — تحديد المزوّد عبر بطارية مزودين + نطاقات nry المرشّحة
// الاستخدام: K_NRY=... node scripts/probe-nry.mjs
const KEY = process.env.K_NRY || "";
const mask = (s) => (s ? String(s).slice(0, 8) + "…" + String(s).slice(-4) : "(فارغ)");
console.log("KEY:", mask(KEY), "| len:", KEY.length);

const j = async (url, opts = {}, t = 12000) => {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(t) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 160); }
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: String(e?.message ?? e).slice(0, 100) }; }
};

const H = { Authorization: `Bearer ${KEY}` };

// 1) مزودو OpenAI-المتوافق الكبار + بوابات الوكلاء الشائعة
const gateways = [
  ["kie", "https://api.kie.ai/api/v1/chat/credit"],
  ["openrouter", "https://openrouter.ai/api/v1/auth/key"],
  ["cometapi", "https://api.cometapi.com/v1/models"],
  ["groq", "https://api.groq.com/openai/v1/models"],
  ["deepseek", "https://api.deepseek.com/v1/models"],
  ["moonshot", "https://api.moonshot.cn/v1/models"],
  ["together", "https://api.together.xyz/v1/models"],
  ["siliconflow", "https://api.siliconflow.cn/v1/models"],
  ["mistral", "https://api.mistral.ai/v1/models"],
  ["dashscope", "https://dashscope.aliyuncs.com/compatible-mode/v1/models"],
  ["zhipu", "https://open.bigmodel.cn/api/paas/v4/models"],
  ["a4f", "https://api.a4f.co/v1/models"],
  ["aimlapi", "https://api.aimlapi.com/v1/models"],
  ["302ai", "https://api.302.ai/v1/models"],
  ["electronhub", "https://api.electronhub.top/v1/models"],
  ["zuki", "https://api.zukijourney.com/v1/models"],
  ["ppinfra", "https://api.ppinfra.com/v1/models"],
  ["chatanywhere", "https://api.chatanywhere.tech/v1/models"],
  ["ohmygpt", "https://api.ohmygpt.com/v1/models"],
  ["closeai", "https://api.closeai-proxy.xyz/v1/models"],
  ["skailar", "https://api.skailar.it/v1/models"],
  ["openai", "https://api.openai.com/v1/models"],
  ["anyrouter", "https://api.anyrouter.dev/api/v1/auth/key"],
  ["novita", "https://api.novita.ai/v3/openai/models"],
  ["fireworks", "https://api.fireworks.ai/inference/v1/models"],
  ["perplexity", "https://api.perplexity.ai/models"],
  ["xai", "https://api.x.ai/v1/models"],
  ["hyperbolic", "https://api.hyperbolic.xyz/v1/models"],
  ["deepinfra", "https://api.deepinfra.com/v1/openai/models"],
  ["lambdalabs", "https://api.lambda.ai/v1/models"],
];

// 2) نطاقات مرشّحة لمزود باسم nry
const nryDomains = [
  ["nry-ai", "https://api.nry.ai/v1/models"],
  ["nry-ai-bare", "https://nry.ai/v1/models"],
  ["nry-pro", "https://api.nry.pro/v1/models"],
  ["nry-top", "https://api.nry.top/v1/models"],
  ["nry-one", "https://api.nry.one/v1/models"],
  ["nry-io", "https://api.nry.io/v1/models"],
  ["nry-wtf", "https://api.nry.wtf/v1/models"],
  ["nry-dev", "https://api.nry.dev/v1/models"],
  ["nry-site", "https://api.nry.site/v1/models"],
  ["nry-cc", "https://api.nry.cc/v1/models"],
  ["nry-vip", "https://api.nry.vip/v1/models"],
  ["nry-icu", "https://api.nry.icu/v1/models"],
  ["nry-app", "https://api.nry.app/v1/models"],
  ["nry-cloud", "https://api.nry.cloud/v1/models"],
];

// 3) مزودو صور/فيديو المتخصصون
const specialists = [
  ["civitai", "https://civitai.com/api/v1/me", {}],
  ["stability", "https://api.stability.ai/v1/user/account", {}],
  ["leonardo", "https://cloud.leonardo.ai/api/rest/v1/me", {}],
  ["luma", "https://api.lumalabs.ai/dream-machine/v1/generations?limit=1", {}],
  ["runway", "https://api.dev.runwayml.com/v1/organization", { "X-Runway-Version": "2024-11-06" }],
  ["getimg", "https://api.getimg.ai/v1/models", {}],
  ["baseten", "https://api.baseten.co/models/active", {}],
  ["replicate", "https://api.replicate.com/v1/account", {}],
  ["vidu", "https://api.vidu.com/ent/v2/tasks?page_num=1&page_size=1", {}],
  ["tensorart", "https://api.tensor.art/openapi/api/v1/users/user-info", {}],
  ["recraft", "https://api.recraft.ai/v1/models", {}],
  ["ideogram", "https://api.ideogram.ai/v1/users/me", {}],
  ["openart", "https://api.openart.ai/api/v1/me", {}],
  ["bfl", "https://api.bfl.ai/v1/get_result?id=00000000-0000-0000-0000-000000000000", { "x-key": KEY }],
];

const run = async (list, tag) => {
  const out = [];
  for (let i = 0; i < list.length; i += 6) {
    const batch = list.slice(i, i + 6);
    const rs = await Promise.all(batch.map(async ([name, url, extra]) => {
      const r = await j(url, { headers: { ...H, ...(extra || {}) } });
      return { name, status: r.status, head: JSON.stringify(r.body).slice(0, 140) };
    }));
    out.push(...rs);
  }
  for (const r of out) console.log(tag + ":", JSON.stringify(r));
};

await run(gateways.map(([n, u]) => [n, u, {}]), "GATEWAY");
await run(nryDomains.map(([n, u]) => [n, u, {}]), "NRY_DOMAIN");
await run(specialists, "SPECIALIST");

// 4) Bynara router (router.bynara.id) — المزوّد المحدَّد عبر البحث: مفاتيحه بصيغة sk-nry-
{
  const info = await j("https://router.bynara.id/v1/models", { headers: H }, 20000);
  const ids = (info.body?.data ?? []).map((m) => m.id ?? m.name).filter(Boolean);
  console.log("BYNARA_MODELS:", JSON.stringify({ status: info.status, total: ids.length,
    head: status0(info) ? String(info.body).slice(0, 200) : null,
    media: ids.filter((i) => /image|img|flux|banana|imagen|dall|seedream|seedance|video|sora|veo|imagine|kling|wan|diffusion|photo|picture|canvas|poster|whisper|tts|audio/i.test(i)).slice(0, 40),
    free: ids.filter((i) => /free/i.test(i)).slice(0, 30),
    sample: ids.slice(0, 25) }));
  // اختبار نصي رخيص للتأكد من عمل المفتاح
  const chat = await j("https://router.bynara.id/v1/chat/completions", {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ model: ids[0] || "gpt-4o-mini", messages: [{ role: "user", content: "قل: تم" }], max_tokens: 10 }),
  }, 45000);
  console.log("BYNARA_CHAT:", JSON.stringify({ status: chat.status,
    content: String(chat.body?.choices?.[0]?.message?.content ?? "").slice(0, 60),
    err: JSON.stringify(chat.body?.error ?? chat.body).slice(0, 250) }));
}
function status0(r) { return r.status === 0 || (r.status >= 400); }

console.log("DONE");
