// اختبار نهائي لمفتاح Bynara (sk-nry-) — نداء chat/completions بسيط
// الاستخدام: K_NRY=... node scripts/validate-bynara.mjs
const KEY = process.env.K_NRY || "";
const mask = (s) => String(s).slice(0, 8) + "…" + String(s).slice(-4);
console.log("KEY:", mask(KEY));

const tryChat = async (model, ms) => {
  try {
    const res = await fetch("https://router.bynara.id/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 8 }),
      signal: AbortSignal.timeout(ms),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    return { model, status: res.status,
      content: String(body?.choices?.[0]?.message?.content ?? "").slice(0, 40),
      err: JSON.stringify(body?.error ?? (body?.choices ? null : body)).slice(0, 220) };
  } catch (e) { return { model, status: 0, err: String(e?.message ?? e).slice(0, 120) }; }
};

// نماذج سريعة من الكتالوج (47 نموذجًا نصيًا) — الأصغر أولًا
for (const m of ["deepseek-v4.1-flash", "glm-5.3-flash", "agnes-3-flash"]) {
  console.log("CHAT:", JSON.stringify(await tryChat(m, 90000)));
}
console.log("DONE");
