// متابعة مهمة الفيديو الجارية — استطلاع حتى الاكتمال
const BASE = process.argv[2] || "http://localhost:3000";
const taskId = process.argv[3];

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

const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  const r = await rpc("tools/call", { name: "get_task", arguments: { task_id: taskId } }, 2);
  const t = r.content?.[0]?.text ?? "";
  const el = Math.round((Date.now() - (Date.now() - 1)) / 1000);
  if (r.isError) { console.log("FAIL:", t.slice(0, 300)); process.exit(1); }
  if (t.includes("✅")) {
    console.log("COMPLETED:\n" + t);
    const u = t.match(/https?:\/\/[^\s)]+/);
    if (u) {
      const head = await fetch(u[0], { method: "HEAD" }).catch(() => null);
      console.log("link check:", head && head.ok ? `PASS (${head.status}, ${head.headers.get("content-type")}, ${head.headers.get("content-length") ?? "?"} bytes)` : "FAIL");
    }
    process.exit(0);
  }
  process.stdout.write("processing... ");
  await new Promise((s) => setTimeout(s, 10_000));
}
console.log("TIMEOUT");
process.exit(2);
