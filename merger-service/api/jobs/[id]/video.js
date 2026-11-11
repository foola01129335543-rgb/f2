// =============================================================================
// GET /api/jobs/{id}/video — بث الناتج بدعم Range (206 + Content-Range)
// ?download=1 → Content-Disposition: attachment للتحميل المباشر
// =============================================================================
const { json, errorJson } = require("../../../lib/http");
const { getJob } = require("../../../lib/db");
const { blobSize, streamBlobToRes, parseRange } = require("../../../lib/storage");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, {});
  if (req.method !== "GET" && req.method !== "HEAD") return errorJson(res, 405, "طريقة غير مسموحة — استخدم GET");
  const { id } = req.query;
  if (!id) return errorJson(res, 400, "معرّف المهمة مطلوب");
  const jobId = String(id);

  try {
    const job = await getJob(jobId);
    if (!job) return errorJson(res, 404, "المهمة غير موجودة (قد تكون حُذفت أو انتهت صلاحيتها بعد 24 ساعة)");

    const totalSize = await blobSize("output_chunks", "job_id = ?", [jobId]);
    if (totalSize === 0) return errorJson(res, 404, "الناتج غير متوفر (المهمة لم تكتمل بعد أو أجزاؤها حُذفت)");

    const range = parseRange(req.headers.range, totalSize);
    if (range && range.invalid) {
      res.setHeader("Content-Range", `bytes */${totalSize}`);
      return errorJson(res, 416, "نطاق بايتات غير صالح");
    }

    const extra = {};
    if (req.query.download === "1" || req.query.download === "true") {
      extra["Content-Disposition"] = `attachment; filename="merged-${jobId}.mp4"`;
    } else {
      extra["Content-Disposition"] = `inline; filename="merged-${jobId}.mp4"`;
    }

    await streamBlobToRes(res, {
      table: "output_chunks",
      where: "job_id = ?",
      args: [jobId],
      totalSize,
      range,
      headers: extra,
      headOnly: req.method === "HEAD", // HEAD: ترويسات فقط بلا جسم
    });
  } catch (e) {
    if (!res.headersSent) errorJson(res, 500, `فشل البث: ${e.message}`);
    else res.end();
  }
};
