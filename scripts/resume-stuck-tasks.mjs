// استئناف المهام المتعطلة عبر استدعاء get_task على الـ MCP endpoint المحلي
// get_task على مهمة بلا provider_task_id ⇒ يعيد محاولة الإنشاء تلقائيًا بعد التهدئة
const BASE = "http://localhost:3000/mcp";

async function mcpCall(method, params, id, sessionId) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  const sid = res.headers.get("mcp-session-id");
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {
    // قد تكون SSE — استخرج data:
    const m = text.match(/data: (.+)/);
    if (m) body = JSON.parse(m[1]);
  }
  return { status: res.status, sessionId: sid, body };
}

const TASKS = process.argv.slice(2);
let sessionId = null;

(async () => {
  // initialize أولاً كما يشترط بروتوكول MCP
  const init = await mcpCall("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "resume-script", version: "1.0" },
  }, 0);
  sessionId = init.sessionId;
  console.log("initialize →", init.status, sessionId ? "session OK" : "no session");
  await mcpCall("notifications/initialized", {}, undefined, sessionId).catch(() => {});

  for (const tid of TASKS) {
    try {
      const r = await mcpCall("tools/call", {
        name: "get_task",
        arguments: { task_id: tid },
      }, tid, sessionId);
      const txt = r.body?.result?.content?.[0]?.text ?? JSON.stringify(r.body).slice(0, 300);
      console.log(`\n[${tid.slice(0, 8)}] HTTP ${r.status}:`, String(txt).slice(0, 280));
    } catch (e) {
      console.log(`\n[${tid.slice(0, 8)}] ERROR:`, String(e).slice(0, 150));
    }
    await new Promise((s) => setTimeout(s, 2_000));
  }
})();
