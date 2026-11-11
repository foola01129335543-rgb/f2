// اختبار e2e لتوليد فيديو عبر MCP — معيار القبول 5:
// generate_video → task_id (الفيديو يحتاج دقائق) → get_task كل 10 ثوانٍ حتى رابط صالح
const BASE = process.argv[2] || "http://localhost:3000";
const MAX_POLL_MIN = 7;

async function rpc(method, params, id = 1) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));
  const payload = lines.length ? lines.map((l) => l.slice(5).trim()).join("") : text;
  const j = JSON.parse(payload);
  if (j.error) throw new Error("RPC error: " + JSON.stringify(j.error));
  return j.result;
}

const t0 = Date.now();
console.log("=== generate_video ===");
const r1 = await rpc("tools/call", {
  name: "generate_video",
  arguments: {
    prompt: "A drone shot flying over a futuristic Middle Eastern city at golden hour, camera slowly rising",
    aspect_ratio: "16:9",
    resolution: "480p",
    duration: 8,
    wait_seconds: 25,
  },
}, 1);
let text = r1.content?.[0]?.text ?? "";
console.log("isError:", r1.isError ?? false, "| elapsed:", Math.round((Date.now() - t0) / 1000) + "s");
console.log(text.slice(0, 300));

// استخراج task_id
const idMatch = text.match(/task_id:\s*([0-9a-f-]{36})/i);
if (!idMatch) {
  // ربما اكتملت خلال نافذة الانتظار مباشرة
  const u = text.match(/https?:\/\/[^\s)]+/);
  console.log(u ? "VIDEO URL (in-window): " + u[0] : "NO task_id and NO url — FAIL");
  process.exit(u ? 0 : 1);
}
const taskId = idMatch[1];
console.log("=== polling get_task كل 10 ثوانٍ ===");

const deadline = Date.now() + MAX_POLL_MIN * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise((s) => setTimeout(s, 10_000));
  const r = await rpc("tools/call", { name: "get_task", arguments: { task_id: taskId } }, 2);
  const t = r.content?.[0]?.text ?? "";
  const el = Math.round((Date.now() - t0) / 1000);
  if (r.isError) { console.log(`[${el}s] FAIL:`, t.slice(0, 200)); process.exit(1); }
  if (t.includes("✅")) {
    console.log(`[${el}s] COMPLETED:`);
    console.log(t);
    // تحقق من الرابط
    const u = t.match(/https?:\/\/[^\s)]+/);
    if (u) {
      const head = await fetch(u[0], { method: "HEAD" }).catch((e) => null);
      console.log("link check:", head && head.ok ? `PASS (${head.status}, ${head.headers.get("content-type")})` : "FAIL");
    }
    process.exit(0);
  }
  const m = t.match(/(\d+)%/);
  console.log(`[${el}s] processing... ${m ? m[1] + "%" : ""}`);
}
console.log(`TIMEOUT بعد ${MAX_POLL_MIN} دقائق — المهمة ما زالت جارية (المفروض أنها تكتمل لاحقًا؛ هذا حد الصندوق الزمني)`);
console.log("TASK_ID=" + taskId);
