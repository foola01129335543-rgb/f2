// =============================================================================
// POST /api/upload?job={id}&seq={n}&chunk={k} — رفع أجزاء الملفات (ثنائي ≤4MB)
// كل جزء 4MB يُقسَّم داخليًا إلى صفَّي 2MB (حد Turso). إعادة المحاولة لكتابة نفس
// الجزء آمنة: تُحذف صفوفه القديمة ثم تُكتب من جديد (semantics: overwrite).
// =============================================================================
const { json, errorJson, readRawBody, MAX_UPLOAD_BYTES } = require("../lib/http");
const { getJob, updateJob, listSources, db } = require("../lib/db");
const { CHUNK_SIZE, writeBlob, deleteBlob } = require("../lib/storage");

const UPLOAD_CHUNK = 4 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, {});
  if (req.method !== "POST") return errorJson(res, 405, "طريقة غير مسموحة — استخدم POST");

  const jobId = String(req.query.job ?? "");
  const seq = Number(req.query.seq ?? -1);
  const chunkIndex = Number(req.query.chunk ?? -1);
  if (!jobId || !Number.isInteger(seq) || seq < 0 || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return errorJson(res, 400, "معاملات الرفع مطلوبة: job و seq و chunk");
  }

  try {
    const job = await getJob(jobId);
    if (!job) return errorJson(res, 404, "المهمة غير موجودة");
    const sources = await listSources(jobId);
    const src = sources.find((s) => s.seq === seq);
    if (!src) return errorJson(res, 404, "المصدر غير موجود في هذه المهمة");
    if (src.kind !== "file") return errorJson(res, 409, "هذا المصدر رابط وليس ملفًا مرفوعًا");
    if (job.status === "done") return errorJson(res, 409, "المهمة مكتملة بالفعل");

    let body;
    try {
      body = await readRawBody(req, MAX_UPLOAD_BYTES);
    } catch (e) {
      return errorJson(res, e.statusCode ?? 413, e.message ?? "الجسم أكبر من الحد المسموح");
    }
    if (!body.length) return errorJson(res, 400, "جسم فارغ — أرسل بايتات الملف الخام (application/octet-stream)");
    if (body.length > UPLOAD_CHUNK) return errorJson(res, 413, "الجزء أكبر من 4MB — قسّم الرفع إلى أجزاء أصغر");

    // صفوف هذا الجزء: الجزء k يغطي الصفوف [k*ROWS_PER_CHUNK, (k+1)*ROWS_PER_CHUNK)
    const ROWS_PER_CHUNK = UPLOAD_CHUNK / CHUNK_SIZE;
    const startRow = chunkIndex * ROWS_PER_CHUNK;
    const expectedOffset = chunkIndex * UPLOAD_CHUNK;
    if (expectedOffset >= src.size) return errorJson(res, 400, "تجاوزت حجم الملف المعلن — جزء زائد");

    // إعادة المحاولة: احذف صفوف الجزء نفسه ثم اكتبها من جديد
    await deleteBlob(
      "source_chunks",
      "job_id = ? AND source_seq = ? AND row_index >= ? AND row_index < ?",
      [jobId, seq, startRow, startRow + ROWS_PER_CHUNK]
    );
    await writeBlob("source_chunks", ["job_id", "source_seq"], [jobId, seq], body, startRow);

    // تحديث المستلَم — ثم إن اكتملت كل ملفات المهمة ننتقل إلى queued
    const received = Math.max(src.received, Math.min(expectedOffset + body.length, src.size));
    await updateSourceReceivedSafe(jobId, seq, received);

    const all = (await listSources(jobId)).filter((s) => s.kind === "file");
    const allDone = all.every((s) => s.size && s.received >= s.size);
    if (allDone && job.status === "uploading") {
      await updateJob(jobId, { status: "queued" });
    }

    json(res, 200, {
      ok: true,
      received,
      size: src.size,
      complete: src.size ? received >= src.size : false,
      jobStatus: allDone && job.status === "uploading" ? "queued" : String(job.status),
    });
  } catch (e) {
    errorJson(res, 500, `فشل الرفع: ${e.message}`);
  }
};

async function updateSourceReceivedSafe(jobId, seq, received) {
  await db().execute({
    sql: `UPDATE sources SET received = ? WHERE job_id = ? AND seq = ?`,
    args: [received, jobId, seq],
  });
}
