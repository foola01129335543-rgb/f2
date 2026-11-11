// =============================================================================
// GET    /api/jobs/{id} — الحالة + التقدم (0–100) + الرابط عند الاكتمال
// DELETE /api/jobs/{id} — حذف فوري شامل (jobs + sources + source_chunks + output_chunks)
// =============================================================================
const { json, errorJson } = require("../../lib/http");
const { getJob, deleteJobCascade } = require("../../lib/db");
const { baseUrlFromReq, jobUrls } = require("../../lib/util");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, {});
  const { id } = req.query;
  if (!id) return errorJson(res, 400, "معرّف المهمة مطلوب");

  if (req.method === "DELETE") {
    try {
      const job = await getJob(String(id));
      if (!job) return errorJson(res, 404, "المهمة غير موجودة");
      await deleteJobCascade(String(id));
      return json(res, 200, { ok: true });
    } catch (e) {
      return errorJson(res, 500, `فشل الحذف: ${e.message}`);
    }
  }

  if (req.method !== "GET") return errorJson(res, 405, "طريقة غير مسموحة — استخدم GET أو DELETE");

  try {
    const job = await getJob(String(id));
    if (!job) return errorJson(res, 404, "المهمة غير موجودة (قد تكون حُذفت أو انتهت صلاحيتها بعد 24 ساعة)");

    const urls = jobUrls(baseUrlFromReq(req), String(id));
    const out = {
      jobId: String(id),
      status: String(job.status),
      progress: Number(job.progress ?? 0),
      expiresAt: String(job.expires_at ?? ""),
      // رابط النتيجة: نفضّل المخزن ثم نبنيه من المعرف عند الاكتمال
      videoUrl: job.video_url ? String(job.video_url) : String(job.status) === "done" ? urls.videoUrl : undefined,
      downloadUrl: job.download_url ? String(job.download_url) : String(job.status) === "done" ? urls.downloadUrl : undefined,
    };
    if (job.output_size !== null && job.output_size !== undefined) out.size = Number(job.output_size);
    if (job.output_duration !== null && job.output_duration !== undefined) out.duration = Number(job.output_duration);
    if (job.output_resolution) out.resolution = String(job.output_resolution);
    if (job.error) out.error = String(job.error);

    json(res, 200, out);
  } catch (e) {
    errorJson(res, 500, `فشل جلب الحالة: ${e.message}`);
  }
};
