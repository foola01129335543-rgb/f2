// =============================================================================
// أدوات مشتركة للدوال — توليد المعرفات، BASE URL، صيغة التاريخ المتوافقة مع SQLite
// =============================================================================
const crypto = require("crypto");

function genJobId() {
  return crypto.randomBytes(6).toString("hex") + crypto.randomBytes(3).toString("hex");
}

/** تاريخ بصيغة SQLite datetime('now') (UTC) للمقارنات النصية */
function sqliteNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

/** BASE URL من الترويسات (يعمل محليًا وعلى Vercel خلف بروكسي) */
function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] ?? (req.socket?.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:3000";
  return `${proto}://${host}`;
}

function jobUrls(baseUrl, jobId) {
  return {
    statusUrl: `${baseUrl}/api/jobs/${jobId}`,
    processUrl: `${baseUrl}/api/jobs/${jobId}/process`,
    videoUrl: `${baseUrl}/api/jobs/${jobId}/video`,
    downloadUrl: `${baseUrl}/api/jobs/${jobId}/video?download=1`,
  };
}

module.exports = { genJobId, sqliteNow, baseUrlFromReq, jobUrls };
