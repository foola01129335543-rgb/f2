// =============================================================================
// التخزين — تقسيم Blobs إلى صفوف 2MB (حد HTTP في Turso) وقراءة تدفقيًا بصفحات 8 صفوف
// + بث الفيديو بدعم Range (206 + Content-Range) ليعمل التقديم/الترجيع في المشغل
// =============================================================================
const { db, ensureSchema } = require("./db");

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB لكل صف
const PAGE_ROWS = 8;                // صفوف لكل استعلام عند القراءة التدفقيّة

/**
 * كتابة Blob كصفوف 2MB في جدول (source_chunks أو output_chunks)
 * columns/values: الأعمدة الثابتة لكل الصفوف (مثل ["job_id","source_seq"] / [jobId, seq])
 * rowBase: إن مُرّر يبدأ row_index منه (رفع بالأجزاء)، وإلا يُرقَّم من 0 تلقائيًا
 */
async function writeBlob(table, columns, values, buffer, rowBase = null) {
  const cols = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const rows = [];
  for (let off = 0, idx = 0; idx === 0 || off < buffer.length; off += CHUNK_SIZE, idx++) {
    const slice = buffer.subarray(off, Math.min(off + CHUNK_SIZE, buffer.length));
    const rowIndex = rowBase === null ? idx : rowBase + idx;
    rows.push({
      sql: `INSERT INTO ${table} (${cols}, row_index, data) VALUES (${placeholders}, ?, ?)`,
      args: [...values, rowIndex, Buffer.from(slice)],
    });
    if (off >= buffer.length) break;
  }
  await db().batch(rows, "write");
}

/** حذف صفوف Blob لمهمة/مصدر */
async function deleteBlob(table, where, args) {
  await db().execute({ sql: `DELETE FROM ${table} WHERE ${where}`, args });
}

/** الحجم الكلي المخزّن بالبايتات */
async function blobSize(table, where, args) {
  const rs = await db().execute({ sql: `SELECT COALESCE(SUM(LENGTH(data)), 0) AS s FROM ${table} WHERE ${where}`, args });
  return Number(rs.rows[0]?.s ?? 0);
}

/**
 * بث Blob إلى استجابة Node بدعم Range.
 * range: {start, end} مطلقًا أو null لكامل الملف.
 */
async function streamBlobToRes(res, { table, where, args, totalSize, range, headers, headOnly = false }) {
  await ensureSchema();
  const start = range ? range.start : 0;
  const end = range ? Math.min(range.end, totalSize - 1) : totalSize - 1;
  const length = end - start + 1;

  if (range) res.status(206);
  else res.status(200);
  corsHeaders(res, headers);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(length));
  if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);

  if (headOnly || length <= 0 || totalSize === 0) {
    res.end();
    return;
  }

  // نمرّ على الصفوف صفحةً صفحة ونكتب الجزء المطلوب فقط
  let offset = 0;        // إزاحة البداية لكل صفحة
  let remaining = length;
  let rowIndex = 0;
  let writtenStart = false;

  while (remaining > 0) {
    const rs = await db().execute({
      sql: `SELECT row_index, data FROM ${table} WHERE ${where} ORDER BY row_index ASC LIMIT ${PAGE_ROWS} OFFSET ${rowIndex}`,
      args,
    });
    if (!rs.rows.length) break;
    for (const row of rs.rows) {
      const buf = Buffer.from(row.data);
      const rowStart = offset;
      const rowEnd = offset + buf.length; // حصري
      offset = rowEnd;

      // خارج النطاق؟
      if (rowEnd <= start) continue;
      if (rowStart > end) { remaining = 0; break; }

      const from = Math.max(start, rowStart) - rowStart;
      const to = Math.min(end + 1, rowEnd) - rowStart;
      const piece = buf.subarray(from, to);
      res.write(piece);
      remaining -= piece.length;
      if (remaining <= 0) break;
      void writtenStart;
    }
    rowIndex += rs.rows.length;
    if (rs.rows.length < PAGE_ROWS) break;
  }
  res.end();
}

function corsHeaders(res, extra) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  if (extra) for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}

/** تحليل ترويسة Range: "bytes=start-end" */
function parseRange(header, totalSize) {
  if (!header) return null;
  const m = String(header).match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  let start = m[1] === "" ? null : parseInt(m[1], 10);
  let end = m[2] === "" ? null : parseInt(m[2], 10);
  if (start === null && end !== null) {
    // آخر N بايت
    start = Math.max(0, totalSize - end);
    end = totalSize - 1;
  } else if (start !== null && end === null) {
    end = totalSize - 1;
  } else if (start === null && end === null) {
    return null;
  }
  if (start > end || start >= totalSize) return { invalid: true };
  return { start, end: Math.min(end, totalSize - 1) };
}

module.exports = { CHUNK_SIZE, PAGE_ROWS, writeBlob, deleteBlob, blobSize, streamBlobToRes, parseRange, corsHeaders };
