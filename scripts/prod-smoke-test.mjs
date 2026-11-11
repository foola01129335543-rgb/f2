// اختبار حي لتوليد صورة عبر MCP على الرابط المحدد (افتراضي: الإنتاج)
const BASE = process.argv[2] || "https://f2-brown.vercel.app/mcp";

async function mcpCall(method, params, id, sessionId) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(150_000),
  });
  const sid = res.headers.get("mcp-session-id");
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {
    const m = text.match(/data: (.+)/);
    if (m) body = JSON.parse(m[1]);
  }
  return { status: res.status, sessionId: sid, body };
}

(async () => {
  const init = await mcpCall("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "prod-test", version: "1.0" },
  }, 0);
  const sessionId = init.sessionId;
  await mcpCall("notifications/initialized", {}, undefined, sessionId).catch(() => {});
  console.log("initialize →", init.status);

  const r = await mcpCall("tools/call", {
    name: "generate_image",
    arguments: { prompt: "a tiny red paper airplane on a clean white desk, soft daylight, minimal photo", wait_seconds: 90 },
  }, 1, sessionId);
  const txt = r.body?.result?.content?.[0]?.text ?? JSON.stringify(r.body).slice(0, 400);
  console.log("generate_image:", String(txt).slice(0, 400));
})();
