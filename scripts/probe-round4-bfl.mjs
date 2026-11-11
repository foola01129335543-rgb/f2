// جولة رابعة: التحقق القطعي من مفتاح UAA ضد BFL (x-key) + توليد تجريبي إن صح
const K_UAA = process.env.K_UAA || "";

const j = async (url, opts = {}, t = 60000) => {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(t) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 250); }
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: String(e?.message ?? e).slice(0, 120) }; }
};

const poll = "https://api.bfl.ai/v1/get_result?id=00000000-0000-0000-0000-000000000000";
{
  const good = await j(poll, { headers: { "x-key": K_UAA } });
  const bad = await j(poll, { headers: { "x-key": "garbage-invalid-key-for-comparison" } });
  const none = await j(poll);
  console.log("BFL_COMPARE:", JSON.stringify({
    uaa: { status: good.status, head: JSON.stringify(good.body).slice(0, 160) },
    garbage: { status: bad.status, head: JSON.stringify(bad.body).slice(0, 160) },
    none: { status: none.status, head: JSON.stringify(none.body).slice(0, 160) },
  }));
}

// توليد تجريبي حقيقي على BFL — إن نجح فالمفتاح BFL وله رصيد/تجربة مجانية
{
  const r = await j("https://api.bfl.ai/v1/flux-pro-1.1", {
    method: "POST",
    headers: { "x-key": K_UAA, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "a tiny red apple on a white background, product photo", width: 1024, height: 768 }),
  });
  console.log("BFL_GENERATE:", JSON.stringify({ status: r.status, head: JSON.stringify(r.body).slice(0, 400) }));
  const id = r.body?.id;
  if (id) {
    const pu = r.body?.polling_url ?? `https://api.bfl.ai/v1/get_result?id=${id}`;
    for (let i = 0; i < 12; i++) {
      await new Promise((s) => setTimeout(s, 5000));
      const p = await j(pu, { headers: { "x-key": K_UAA } });
      const st = String(p.body?.status ?? "");
      console.log("BFL_POLL:", JSON.stringify({ i, status: st, progress: p.body?.progress,
        sample: p.body?.result?.sample ?? null }));
      if (st === "Ready" || st === "Error" || p.status === 401 || p.status === 402) break;
    }
  }
}
console.log("DONE");
