// =============================================================================
// خادم تطوير محلي يحاكي بيئة Vercel:
// - يحلّل المسارات الديناميكية (/api/jobs/{id}) ويضعها في req.query.id
// - يقدّم واجهة public/ على /
// - يستخدم نفس ملفات api/ المستخدمة على Vercel حرفيًا
// =============================================================================
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT ?? 3001);
const ROOT = path.join(__dirname, "..");

const ROUTES = [
  { method: "GET", re: /^\/api\/config\/?$/, mod: "../api/config" },
  { method: "GET", re: /^\/api\/cron\/?$/, mod: "../api/cron" },
  { method: ["POST", "OPTIONS"], re: /^\/api\/upload\/?$/, mod: "../api/upload" },
  { method: ["POST", "OPTIONS"], re: /^\/api\/jobs\/?$/, mod: "../api/jobs" },
  { method: ["GET", "DELETE", "OPTIONS"], re: /^\/api\/jobs\/(?<id>[^/]+)\/?$/, mod: "../api/jobs/[id]" },
  { method: ["POST", "OPTIONS"], re: /^\/api\/jobs\/(?<id>[^/]+)\/process\/?$/, mod: "../api/jobs/[id]/process" },
  { method: ["GET", "OPTIONS"], re: /^\/api\/jobs\/(?<id>[^/]+)\/video\/?$/, mod: "../api/jobs/[id]/video" },
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  req.query = Object.fromEntries(url.searchParams);

  // محاكاة مساعدات Vercel على استجابة Node الخام حتى تعمل نفس ملفات api/ حرفيًا
  if (!res.status) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      const body = JSON.stringify(obj);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Length", String(Buffer.byteLength(body)));
      res.end(body);
      return res;
    };
  }

  // المسار → الدالة (كل الطرق تُمرَّر للدالة كما في Vercel — والدالة نفسها ترد 405 عند اللزوم)
  for (const r of ROUTES) {
    const m = url.pathname.match(r.re);
    if (!m) continue;
    Object.assign(req.query, m.groups ?? {});
    const handler = require(r.mod);
    try {
      await handler(req, res);
    } catch (e) {
      console.error("handler error:", e);
      if (!res.headersSent) res.status(500).json({ error: e.message ?? "خطأ داخلي" });
      else res.end();
    }
    return;
  }

  // الواجهة الثابتة
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  const abs = path.join(ROOT, "public", path.normalize(file).replace(/^([.][.][/\\])+/, ""));
  if (abs.startsWith(path.join(ROOT, "public")) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
    res.writeHead(200, { "Content-Type": types[path.extname(abs)] ?? "application/octet-stream" });
    fs.createReadStream(abs).pipe(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "المسار غير موجود" }));
});

server.listen(PORT, () => {
  console.log(`▶ خادم تطوير خدمة الدمج يعمل على http://localhost:${PORT}`);
  console.log(`  - الواجهة: http://localhost:${PORT}/`);
  console.log(`  - فحص الجهوزية: http://localhost:${PORT}/api/config`);
});
