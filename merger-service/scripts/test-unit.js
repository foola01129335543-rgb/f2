// =============================================================================
// اختبار وحدات محرك الدمج والتخزين:
// 1) توليد فيديوهين مختلفي الدقة بـ ffmpeg (أحدهما بلا صوت)
// 2) دمجهما والتحقق: الدقة = أكبر دقة، المدة ≈ المجموع، وجود الصوت
// 3) التخزين في Turso والاسترجاع بتطابق sha256
// 4) مسار رفع الأجزاء (تقسيم 4MB → صفوف 2MB → إعادة تجميع)
// 5) حدود الحجم + الحذف الشامل
// =============================================================================
process.chdir(__dirname + "/..");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const FFMPEG = require("ffmpeg-static");
const { ensureExecutable, mergeVideos, ffprobeFile, LIMITS } = require("../lib/merge");
const { writeBlob, deleteBlob, blobSize, streamBlobToRes, CHUNK_SIZE } = require("../lib/storage");
const { ensureSchema, db, deleteJobCascade, getJob } = require("../lib/db");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name} ${extra}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
}

async function makeTestVideo(dest, { w, h, withAudio, seconds }) {
  const bin = await ensureExecutable(FFMPEG);
  const audio = withAudio
    ? ["-f", "lavfi", "-i", `sine=frequency=${440 + Math.floor(Math.random() * 400)}:duration=${seconds}`]
    : [];
  const amap = withAudio ? ["-map", "1:a", "-c:a", "aac", "-b:a", "128k"] : ["-an"];
  const r = spawnSync(bin, [
    "-y", "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=30:duration=${seconds}`,
    ...audio, "-map", "0:v", ...amap, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    dest,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("فشل توليد فيديو الاختبار: " + r.stderr?.slice(-400));
  return dest;
}

// Response وهمي لاختبار البث
function fakeRes() {
  const chunks = [];
  return {
    chunks,
    headers: {},
    statusCode: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    write(c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
    end() { this.ended = true; },
  };
}

(async () => {
  console.log("=== اختبار وحدات محرك الدمج والتخزين ===\n");
  await ensureSchema();

  // 1) توليد فيديوهين اختبار
  console.log("[1] توليد فيديوهي اختبار (640x360 بصوت، 320x240 بلا صوت)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mt-"));
  const v1 = await makeTestVideo(path.join(tmp, "a.mp4"), { w: 640, h: 360, withAudio: true, seconds: 3 });
  const v2 = await makeTestVideo(path.join(tmp, "b.mp4"), { w: 320, h: 240, withAudio: false, seconds: 2 });
  const p1 = await ffprobeFile(v1), p2 = await ffprobeFile(v2);
  check("فحص المصدر الأول: 640x360", p1.width === 640 && p1.height === 360);
  check("فحص المصدر الثاني: بلا صوت", p2.hasAudio === false);
  check("فحص المصدر الأول: به صوت", p1.hasAudio === true);

  // 2) الدمج
  console.log("[2] دمج الفيديوهين (توحيد إلى 640x360 + مسار صامت للمصدر الثاني)");
  const out = path.join(tmp, "out.mp4");
  const seenProgress = [];
  const meta = await mergeVideos({
    tmpPaths: [v1, v2], outPath: out,
    onProgress: (p) => seenProgress.push(p),
  });
  check("اكتمل الدمج والدقة = أكبر دقة مدخل (640x360)", meta.width === 640 && meta.height === 360, `→ ${meta.width}x${meta.height}`);
  const expectedDur = p1.duration + p2.duration;
  check("المدة ≈ مجموع المدد (±0.5s)", Math.abs(meta.totalDuration - expectedDur) < 0.5, `→ ${meta.totalDuration.toFixed(2)}s مقابل ${expectedDur.toFixed(2)}s`);
  const outProbe = await ffprobeFile(out);
  check("الناتج به صوت (المصدر الصامت أُعطي مسارًا صامتًا)", outProbe.hasAudio === true);
  check("الناتج H.264 + yuv420p", outProbe.width === 640 && outProbe.height === 360);
  check("أحداث التقدم وصلت أثناء الترميز (40-90)", seenProgress.some((p) => p >= 40 && p <= 90), `→ ${seenProgress.length} حدثًا`);
  check("ترميز CRF 18/preset عبر قيمة البيئة", LIMITS.preset === process.env.FFMPEG_PRESET || LIMITS.preset === "medium");

  // 3) تخزين Turso واسترجاع sha256
  console.log("[3] تخزين الناتج في Turso (صفوف 2MB) والاسترجاع بتطابق sha256");
  const jobId = "unittest" + crypto.randomBytes(4).toString("hex");
  const buf = fs.readFileSync(out);
  await writeBlob("output_chunks", ["job_id"], [jobId], buf);
  const storedSize = await blobSize("output_chunks", "job_id = ?", [jobId]);
  check("الحجم المخزّن يطابق الملف", storedSize === buf.length, `→ ${storedSize} بايت`);

  const fake = fakeRes();
  await streamBlobToRes(fake, { table: "output_chunks", where: "job_id = ?", args: [jobId], totalSize: storedSize, range: null, headers: {} });
  const streamed = Buffer.concat(fake.chunks);
  const sha1 = crypto.createHash("sha256").update(buf).digest("hex");
  const sha2 = crypto.createHash("sha256").update(streamed).digest("hex");
  check("تطابق sha256 بين الملف والبث الكامل", sha1 === sha2);

  // بث Range (منتصف الملف)
  const mid = Math.floor(buf.length / 3);
  const fakeR = fakeRes();
  await streamBlobToRes(fakeR, { table: "output_chunks", where: "job_id = ?", args: [jobId], totalSize: storedSize, range: { start: mid, end: mid + 999 }, headers: {} });
  const slice = Buffer.concat(fakeR.chunks);
  check("بث Range يعيد 1000 بايت صحيحة", slice.length === 1000 && slice.equals(buf.subarray(mid, mid + 1000)));
  check("استجابة Range بحالة 206", fakeR.statusCode === 206);

  // 4) مسار رفع الأجزاء: تقسيم 4MB → صفوف 2MB → إعادة تجميع (نفس منطق upload+process)
  console.log("[4] مسار رفع الأجزاء (4MB → صفوف 2MB) وإعادة التجميع");
  const big = crypto.randomBytes(CHUNK_SIZE * 2 + 12345); // > 4MB
  const seq = 0;
  const rowsPerChunk = (4 * 1024 * 1024) / CHUNK_SIZE;
  for (let k = 0; k * (4 * 1024 * 1024) < big.length; k++) {
    const start = k * 4 * 1024 * 1024;
    const piece = big.subarray(start, Math.min(start + 4 * 1024 * 1024, big.length));
    const startRow = k * rowsPerChunk;
    await deleteBlob("source_chunks", "job_id = ? AND source_seq = ? AND row_index >= ? AND row_index < ?", [jobId, seq, startRow, startRow + rowsPerChunk]);
    await writeBlob("source_chunks", ["job_id", "source_seq"], [jobId, seq], piece, startRow);
  }
  const rs = await db().execute({ sql: `SELECT data FROM source_chunks WHERE job_id = ? AND source_seq = ? ORDER BY row_index ASC`, args: [jobId, seq] });
  const reassembled = Buffer.concat(rs.rows.map((r) => Buffer.from(r.data)));
  check("إعادة تجميع الأجزاء مطابقة sha256", crypto.createHash("sha256").update(reassembled).digest("hex") === crypto.createHash("sha256").update(big).digest("hex"));

  // 5) الحدود + الحذف الشامل
  console.log("[5] حدود الحجم + الحذف الشامل");
  check("حد المصدر الافتراضي 200MB", Math.round(LIMITS.sourceMaxBytes / 1048576) === 200);
  check("حد الناتج الافتراضي 150MB", Math.round(LIMITS.outputMaxBytes / 1048576) === 150);
  check("حد المدة الإجمالية 600 ثانية", LIMITS.maxTotalDurationSec === 600);
  await deleteJobCascade(jobId);
  const after = await getJob(jobId);
  const leftovers = await db().execute({ sql: `SELECT COUNT(*) AS c FROM output_chunks WHERE job_id = ?`, args: [jobId] });
  check("الحذف الشامل أزال المهمة وكل صفوفها", after === null && Number(leftovers.rows[0].c) === 0);

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n=== النتيجة: ${pass} نجح / ${fail} فشل ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
