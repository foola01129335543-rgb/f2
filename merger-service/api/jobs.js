// =============================================================================
// POST /api/jobs — إنشاء مهمة دمج
// يقبل {"videos":["url1","url2"]} أو {"sources":[{kind:"url"|"file", ...}]}
// يرجع 201: {jobId, status, statusUrl, processUrl, expiresAt, uploads?[]}
// =============================================================================
const { json, errorJson, readJsonBody } = require("../lib/http");
const { db, ensureSchema, insertJob, insertSource, deleteExpiredJobs, listSources } = require("../lib/db");
const { LIMITS } = require("../lib/merge");
const { genJobId, sqliteNow, baseUrlFromReq, jobUrls } = require("../lib/util");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, {});
  if (req.method !== "POST") return errorJson(res, 405, "طريقة غير مسموحة — استخدم POST");
  if (req.method === "GET") return json(res, 200, { note: "لا قائمة عامة للمهام" });

  try {
    const body = await readJsonBody(req);

    // تطبيع المصادر من الشكلين المقبولين
    let srcs = [];
    if (Array.isArray(body.videos)) {
      srcs = body.videos.map((u) => ({ kind: "url", url: String(u ?? "") }));
    } else if (Array.isArray(body.sources)) {
      srcs = body.sources.map((s) => ({
        kind: s.kind === "file" ? "file" : "url",
        url: s.url ? String(s.url) : undefined,
        name: s.name ? String(s.name).slice(0, 200) : undefined,
        mime: s.mime ? String(s.mime).slice(0, 100) : undefined,
        size: s.size !== undefined ? Number(s.size) : undefined,
      }));
    } else {
      return errorJson(res, 400, 'جسم الطلب يجب أن يكون {"videos":[...]} أو {"sources":[...]}');
    }

    if (srcs.length < 2) return errorJson(res, 400, "الدمج يحتاج مقطعَين على الأقل");
    if (srcs.length > LIMITS.maxSources) {
      return errorJson(res, 400, `أقصى عدد مقاطع للدمج هو ${LIMITS.maxSources}`);
    }
    for (const s of srcs) {
      if (s.kind === "url") {
        if (!/^https?:\/\/\S+$/i.test(s.url ?? "")) {
          return errorJson(res, 400, `رابط غير صالح (يجب أن يكون http/https مباشرًا وعامًا): ${(s.url ?? "").slice(0, 100)}`);
        }
      } else {
        if (!s.size || s.size <= 0) return errorJson(res, 400, "مصدر ملف بلا حجم صالح");
        if (s.size > LIMITS.sourceMaxBytes) {
          return errorJson(res, 413, `حجم الملف يتجاوز الحد المسموح (${Math.round(LIMITS.sourceMaxBytes / 1024 / 1024)}MB لكل مصدر)`);
        }
      }
    }

    // تنظيف كسول للمهام المنتهية
    try { await deleteExpiredJobs(); } catch { /* التنظيف اختياري */ }

    const id = genJobId();
    const expiresAt = sqliteNow(24 * 60 * 60 * 1000); // تُحذف الملفات تلقائيًا بعد 24 ساعة
    const hasFiles = srcs.some((s) => s.kind === "file");
    const status = hasFiles ? "uploading" : "queued";

    await ensureSchema();
    await insertJob({ id, status, sourcesCount: srcs.length, expiresAt });
    for (let i = 0; i < srcs.length; i++) {
      await insertSource({ jobId: id, seq: i, ...srcs[i] });
    }

    const base = baseUrlFromReq(req);
    const urls = jobUrls(base, id);
    const out = {
      jobId: id,
      status,
      statusUrl: urls.statusUrl,
      processUrl: urls.processUrl,
      expiresAt,
    };
    if (hasFiles) {
      const UPLOAD_CHUNK = 4 * 1024 * 1024;
      out.uploads = srcs
        .map((s, seq) => ({ s, seq }))
        .filter(({ s }) => s.kind === "file")
        .map(({ seq }) => ({
          seq,
          uploadUrl: `${base}/api/upload?job=${id}&seq=${seq}&chunk=`,
          uploadChunkBytes: UPLOAD_CHUNK,
        }));
    }
    json(res, 201, out);
  } catch (e) {
    const status = e.statusCode ?? 500;
    errorJson(res, status, e.message ?? "خطأ غير متوقع");
  }
};

// يُستورد في أماكن أخرى
void listSources; void db;
