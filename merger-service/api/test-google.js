// ملف فحص مؤقت — يجرّب عدة نماذج صور على مفتاح Google ويعيد النتائج كاملة
// يُحذف فورًا بعد الفحص
module.exports = async (req, res) => {
  const key = req.query.key || "";
  const mode = req.query.mode || "probe"; // probe | list
  if (!key) { res.status(400).json({ error: "missing key" }); return; }

  const H = { "x-goog-api-key": key, "Content-Type": "application/json" };
  const BASE = "https://generativelanguage.googleapis.com/v1beta";

  if (mode === "list") {
    const r = await fetch(`${BASE}/models`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(20000) });
    const b = await r.json().catch(() => ({}));
    const names = (b.models ?? []).map(m => m.name);
    res.status(200).json({ count: names.length, imageish: names.filter(n => /image|banana|veo|imagen/i.test(n)) });
    return;
  }

  const models = String(req.query.models || "gemini-2.5-flash-image,gemini-3.1-flash-image,gemini-nano-banana-2.1,nano-banana-pro-preview,gemini-3-pro-image,gemini-2.0-flash-preview-image-generation").split(",").map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const m of models) {
    try {
      const r = await fetch(`${BASE}/models/${encodeURIComponent(m)}:generateContent`, {
        method: "POST", headers: H,
        body: JSON.stringify({ contents: [{ parts: [{ text: "a tiny blue circle on white background" }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
        signal: AbortSignal.timeout(60000),
      });
      const b = await r.json().catch(() => ({}));
      const hasImg = !!(b?.candidates?.[0]?.content?.parts ?? []).find(p => p.inlineData?.data);
      results.push({
        model: m,
        ok: r.ok && hasImg,
        http: r.status,
        imgBytes: hasImg ? Math.round(String(b.candidates[0].content.parts.find(p => p.inlineData.data).inlineData.data).length * 3 / 4) : null,
        err: r.ok ? (hasImg ? null : "لا صورة في الاستجابة") : String(b?.error?.message ?? "").slice(0, 300),
      });
    } catch (e) {
      results.push({ model: m, ok: false, err: String(e).slice(0, 120) });
    }
  }
  res.status(200).json({ results });
};
