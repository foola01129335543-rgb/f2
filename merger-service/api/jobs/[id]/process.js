// =============================================================================
// POST /api/jobs/{id}/process — تنفيذ الدمج كاملًا (متزامن، ~10–15 ثانية عادة)
// نجاح 200: {status:"done", videoUrl, downloadUrl, size, duration, resolution, expiresAt}
// قيد المعالجة: 202 | مصادر ناقصة: 409 | فشل: 500 {"error":"..."} — فشل حتمي لا يُعاد
// =============================================================================
const fsp = require("fs/promises");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { json, errorJson, readJsonBody } = require("../../../lib/http");
const { getJob, updateJob, listSources, db } = require("../../../lib/db");
const { mergeVideos, downloadToFile, LIMITS } = require("../../../lib/merge");
const { writeBlob, deleteBlob, blobSize } = require("../../../lib/storage");
const { baseUrlFromReq, jobUrls } = require("../../../lib/util");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, {});
  if (req.method !== "POST") return errorJson(res, 405, "طريقة غير مسموحة — استخدم POST");
  void readJsonBody;

  const { id } = req.query;
  if (!id) return errorJson(res, 400, "معرّف المهمة مطلوب");
  const jobId = String(id);

  let job;
  try { job = await getJob(jobId); } catch (e) { return errorJson(res, 500, `خطأ قاعدة بيانات: ${e.message}`); }
  if (!job) return errorJson(res, 404, "المهمة غير موجودة (قد تكون حُذفت أو انتهت صلاحيتها بعد 24 ساعة)");

  // نتيجة سابقة — نعيدها كما هي (استدعاء مكرر غير ضار)
  if (job.status === "done") {
    const urls = jobUrls(baseUrlFromReq(req), jobId);
    return json(res, 200, {
      status: "done", progress: 100,
      videoUrl: job.video_url ? String(job.video_url) : urls.videoUrl,
      downloadUrl: job.download_url ? String(job.download_url) : urls.downloadUrl,
      size: Number(job.output_size ?? 0), duration: Number(job.output_duration ?? 0),
      resolution: String(job.output_resolution ?? ""), expiresAt: String(job.expires_at ?? ""),
    });
  }
  // قيد المعالجة الآن (بالتزامن مع طلب آخر) → 202
  if (job.status === "processing") return json(res, 202, { status: "processing", progress: Number(job.progress ?? 0) });

  try {
    const sources = await listSources(jobId);
    const incomplete = sources.find((s) => s.kind === "file" && s.size && s.received < s.size);
    if (incomplete) {
      return errorJson(res, 409, `مصدر رقم ${incomplete.seq + 1} لم يكتمل رفعه (${incomplete.received}/${incomplete.size} بايت)`);
    }
    if (job.status === "uploading") await updateJob(jobId, { status: "queued" });

    await updateJob(jobId, { status: "processing", progress: 2, error: null });
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "merge-"));
    try {
      // 1) تجسيد المصادر إلى /tmp — التقدم 0-40
      const tmpPaths = [];
      const nSources = sources.length;
      for (let i = 0; i < nSources; i++) {
        const s = sources[i];
        const dest = path.join(tmpDir, `src-${String(i).padStart(2, "0")}.mp4`);
        if (s.kind === "url") {
          await downloadToFile(s.url, dest, (r) => {
            const p = Math.round(((i + r) / nSources) * 40);
            updateJob(jobId, { progress: Math.max(2, p) }).catch(() => {});
          });
        } else {
          await assembleFileSource(jobId, s.seq, s.size, dest);
        }
        tmpPaths.push(dest);
        await updateJob(jobId, { progress: Math.max(2, Math.round(((i + 1) / nSources) * 40)) }).catch(() => {});
      }

      // 2) الدمج والتوحيد — التقدم 40-90 من -progress pipe:1
      const outPath = path.join(tmpDir, "out.mp4");
      const meta = await mergeVideos({
        tmpPaths, outPath,
        onProgress: (p) => updateJob(jobId, { progress: p }).catch(() => {}),
      });

      // 3) فحص حجم الناتج ثم تخزينه في Turso — 90-100
      const buf = await fsp.readFile(outPath);
      if (buf.length > LIMITS.outputMaxBytes) {
        throw new Error(`حجم الناتج (${Math.round(buf.length / 1024 / 1024)}MB) يتجاوز الحد المسموح (${Math.round(LIMITS.outputMaxBytes / 1024 / 1024)}MB)`);
      }
      await deleteBlob("output_chunks", "job_id = ?", [jobId]);
      await writeBlob("output_chunks", ["job_id"], [jobId], buf);
      // بعد نجاح الدمج احذف source_chunks — الناتج فقط هو المطلوب
      await deleteBlob("source_chunks", "job_id = ?", [jobId]);

      const urls = jobUrls(baseUrlFromReq(req), jobId);
      const size = await blobSize("output_chunks", "job_id = ?", [jobId]);
      const done = {
        status: "done", progress: 100,
        output_size: size,
        output_duration: meta.totalDuration,
        output_resolution: `${meta.width}x${meta.height}`,
        video_url: urls.videoUrl,
        download_url: urls.downloadUrl,
        error: null,
      };
      await updateJob(jobId, done);
      return json(res, 200, {
        status: "done", progress: 100,
        videoUrl: done.video_url, downloadUrl: done.download_url,
        size: done.output_size, duration: done.output_duration,
        resolution: done.output_resolution, expiresAt: String(job.expires_at ?? ""),
      });
    } finally {
      // لا نظام ملفات دائم — نظّف /tmp دائمًا
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {
    // أي خطأ معلن = فشل نهائي واضح برسالة — وليس انهيارًا
    const msg = e.message ?? "فشل الدمج لسبب غير معروف";
    await updateJob(jobId, { status: "failed", error: msg }).catch(() => {});
    errorJson(res, 500, msg);
  }
};

/** تجميع مصدر ملف مرفوع من صفوف source_chunks (2MB) إلى ملف */
async function assembleFileSource(jobId, seq, expectedSize, dest) {
  const { createWriteStream } = fs;
  const rs = await db().execute({
    sql: `SELECT row_index, data FROM source_chunks WHERE job_id = ? AND source_seq = ? ORDER BY row_index ASC`,
    args: [jobId, seq],
  });
  if (!rs.rows.length) throw new Error(`مصدر رقم ${seq + 1} لا يحتوي أجزاء مرفوعة`);
  const stream = createWriteStream(dest);
  let written = 0;
  for (const row of rs.rows) {
    const buf = Buffer.from(row.data);
    written += buf.length;
    if (!stream.write(buf)) {
      await new Promise((r) => stream.once("drain", r));
    }
  }
  await new Promise((r) => stream.end(r));
  if (expectedSize && Math.abs(written - expectedSize) > 1024) {
    throw new Error(`حجم المصدر رقم ${seq + 1} المخزّن (${written}) لا يطابق الحجم المعلن (${expectedSize})`);
  }
  void blobSize;
}
