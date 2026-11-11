// =============================================================================
// أدوات HTTP مشتركة — استجابات JSON، CORS مفتوح، قراءة الجسم الخام
// =============================================================================
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // حد حجم الطلب في Vercel ≈ 4.5MB

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, obj) {
  cors(res);
  res.status(status).json(obj);
}

function errorJson(res, status, message) {
  json(res, status, { error: message }); // الأخطاء دائمًا بصيغة {"error":"..."}
}

async function readRawBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body !== undefined && req.body !== null && typeof req.body !== "string") {
    // فسّره Vercel تلقائيًا (JSON)
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw Object.assign(new Error("الطلب أكبر من الحد المسموح (4MB)"), { statusCode: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = await readRawBody(req, 1024 * 1024);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON تالف — تعذر تحليل جسم الطلب"), { statusCode: 400 });
  }
}

module.exports = { cors, json, errorJson, readRawBody, readJsonBody, MAX_UPLOAD_BYTES };
