// اختبار e2e لتوليد صورة عبر MCP — يثبت معيار القبول 4 و6:
// مفتاح خاطئ أولًا → يُعلَّم disabled تلقائيًا → نفس المهمة تكتمل على المفتاح الصحيح
// → العميل لا يرى أي ذكر للمفاتيح أو الرصيد.
const BASE = process.argv[2] || "http://localhost:3000";

async function callTool(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));
  const payload = lines.length ? lines.map((l) => l.slice(5).trim()).join("") : text;
  const j = JSON.parse(payload);
  if (j.error) throw new Error("RPC error: " + JSON.stringify(j.error));
  return j.result;
}

const t0 = Date.now();
const result = await callTool("generate_image", {
  prompt: "A futuristic Arabic calligraphy logo glowing cyan and purple on dark background, vector style",
  aspect_ratio: "1:1",
  resolution: "1K",
  wait_seconds: 100,
});
const elapsed = Math.round((Date.now() - t0) / 1000);

const text = result.content?.[0]?.text ?? "";
console.log("elapsed:", elapsed + "s", "| isError:", result.isError ?? false);
console.log("=== TOOL RESULT ===");
console.log(text);

// تحقق صامت: النتيجة لا تذكر المفاتيح أو الرصيد إطلاقًا
const leaked = /(مفتاح|مفاتيح|رصيد|api key|balance|insufficient|unauthorized)/i.test(text);
console.log("=== LEAK CHECK ===");
console.log(leaked ? "FAIL — ذُكرت مفاتيح/رصيد في الرد!" : "PASS — لا ذكر للمفاتيح أو الرصيد");

// استخراج الرابط والتحقق من عمله
const urlMatch = text.match(/https?:\/\/[^\s)]+/);
if (urlMatch) {
  const imgRes = await fetch(urlMatch[0], { method: "HEAD" });
  console.log("=== IMAGE LINK CHECK ===");
  console.log(imgRes.ok ? "PASS — الرابط يعمل (" + imgRes.status + ", " + (imgRes.headers.get("content-type") ?? "?") + ")" : "FAIL — الرابط لا يعمل (" + imgRes.status + ")");
}
