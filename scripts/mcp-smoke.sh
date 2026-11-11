#!/usr/bin/env bash
# اختبار تدفق MCP كامل عبر curl — نفس أمثلة المواصفة
set -e
BASE="${1:-http://localhost:3000}"

echo "=== 1) initialize ==="
INIT=$(curl -s -N -X POST "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}')
echo "$INIT" | head -c 600; echo

echo "=== 2) notifications/initialized ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

echo "=== 3) tools/list ==="
TOOLS=$(curl -s -N -X POST "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
echo "$TOOLS" | node -e '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  // استخراج JSON من حزم SSE إن وجدت
  const lines = s.split("\n").filter(l => l.startsWith("data:"));
  const payload = lines.length ? lines.map(l => l.slice(5).trim()).join("") : s;
  const j = JSON.parse(payload);
  const tools = j.result?.tools ?? [];
  console.log("tools count:", tools.length);
  for (const t of tools) {
    const props = Object.keys(t.inputSchema?.properties ?? {});
    console.log("-", t.name, "| props:", props.join(","));
  }
});
'
