// =============================================================================
// اختبار HTTP كامل ضد خادم التطوير المحلي:
// إنشاء مهمة من روابط → دمج → بث مع Range 206 → مهمة مختلطة (رابط + ملف مرفوع)
// → حذف → 404 → JSON تالف → مقطع واحد مرفوض → /api/config → 405
// =============================================================================
process.chdir(__dirname + "/..");
const BASE = process.env.BASE ?? "http://localhost:3001";
const fs = require("fs");
const path = require("path");
const os = require("os");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name} ${extra}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, res };
}

(async () => {
  console.log(`=== اختبار HTTP كامل ضد ${BASE} ===\n`);

  // 0) config
  const cfg = await jfetch("/api/config");
  check("GET /api/config يعمل", cfg.status === 200 && cfg.body?.limits?.maxSources >= 2);

  // 1) إنشاء مهمة من روابط عامة (مثل أمثلة المواصفة)
  console.log("[1] مهمة دمج من روابط عامة");
  const url1 = "https://www.w3schools.com/html/mov_bbb.mp4";
  const url2 = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4";
  const create = await jfetch("/api/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videos: [url1, url2] }),
  });
  check("إنشاء المهمة يعيد 201", create.status === 201, JSON.stringify(create.body).slice(0, 120));
  const jobId = create.body?.jobId;
  check("الاستجابة تحتوي statusUrl وprocessUrl وexpiresAt",
    Boolean(create.body?.statusUrl && create.body?.processUrl && create.body?.expiresAt));
  check("الحالة الأولية queued", create.body?.status === "queued");

  // 2) تنفيذ الدمج (متزامن)
  console.log("[2] تنفيذ الدمج");
  const proc = await jfetch(`/api/jobs/${jobId}/process`, { method: "POST" });
  check("الدمج نجح بحالة 200 وstatus=done", proc.status === 200 && proc.body?.status === "done", JSON.stringify(proc.body ?? {}).slice(0, 200));
  check("النتيجة تحتوي videoUrl وdownloadUrl وsize وduration وresolution وexpiresAt",
    Boolean(proc.body?.videoUrl && proc.body?.downloadUrl && proc.body?.size > 0 && proc.body?.duration > 0 && proc.body?.resolution && proc.body?.expiresAt));
  check("الرابط على نطاق خدمة الدمج (لا نطاق داخلي)", proc.body?.videoUrl?.startsWith(BASE), `→ ${proc.body?.videoUrl}`);

  // 3) بث الناتج مع Range 206
  console.log("[3] بث الناتج وRange");
  const full = await fetch(`${BASE}/api/jobs/${jobId}/video`);
  check("البث الكامل 200 + video/mp4 + Accept-Ranges", full.status === 200 && (full.headers.get("content-type") ?? "").includes("video/mp4") && full.headers.get("accept-ranges") === "bytes");
  const fullBuf = Buffer.from(await full.arrayBuffer());
  check("البث الكامل حجمه = size المعلن", fullBuf.length === proc.body.size, `→ ${fullBuf.length}`);
  const r1 = await fetch(`${BASE}/api/jobs/${jobId}/video`, { headers: { Range: "bytes=0-1023" } });
  const r1buf = Buffer.from(await r1.arrayBuffer());
  check("Range يعيد 206 + Content-Range صحيح", r1.status === 206 && r1.headers.get("content-range") === `bytes 0-1023/${fullBuf.length}` && r1buf.length === 1024);
  check("البايتات المقصوصة مطابقة", r1buf.equals(fullBuf.subarray(0, 1024)));
  const r2 = await fetch(`${BASE}/api/jobs/${jobId}/video`, { headers: { Range: `bytes=${fullBuf.length - 500}-` } });
  const r2buf = Buffer.from(await r2.arrayBuffer());
  check("Range مفتوح من النهاية يعيد آخر 500 بايت", r2.status === 206 && r2buf.length === 500 && r2buf.equals(fullBuf.subarray(fullBuf.length - 500)));
  const dl = await fetch(`${BASE}/api/jobs/${jobId}/video?download=1`);
  check("?download=1 يعطي Content-Disposition: attachment", (dl.headers.get("content-disposition") ?? "").includes("attachment"));

  // 4) مهمة مختلطة (رابط + ملف مرفوع بالأجزاء مع إعادة محاولة جزء)
  console.log("[4] مهمة مختلطة: رابط + ملف مرفوع");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ht-"));
  const localVid = path.join(tmp, "local.mp4");
  spawnFfmpeg(localVid);
  const fileBuf = fs.readFileSync(localVid);
  const mixed = await jfetch("/api/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources: [{ kind: "url", url: url1 }, { kind: "file", name: "local.mp4", size: fileBuf.length, mime: "video/mp4" }] }),
  });
  check("إنشاء المهمة المختلطة يعيد 201 وstatus=uploading وuploads[]", mixed.status === 201 && mixed.body?.status === "uploading" && Array.isArray(mixed.body?.uploads) && mixed.body.uploads.length === 1);
  const mixedId = mixed.body.jobId;
  const up = mixed.body.uploads[0];
  const CH = up.uploadChunkBytes;
  let attemptNo = 0;
  for (let k = 0; k * CH < fileBuf.length; k++) {
    const piece = fileBuf.subarray(k * CH, Math.min((k + 1) * CH, fileBuf.length));
    attemptNo++;
    // نجرب فشلًا مقصودًا أول مرة لجزء واحد (محاكاة إعادة المحاولة ×3)
    if (attemptNo === 2) {
      const bad = await jfetch(`/api/upload?job=${mixedId}&seq=${up.seq}&chunk=999`, { method: "POST", body: piece });
      check("رفع بجزء متجاوز للحجم المعلن يُرفض", bad.status === 400);
    }
    const upRes = await fetch(`${up.uploadUrl}${k}`, { method: "POST", body: piece, headers: { "Content-Type": "application/octet-stream" } });
    check(`رفع الجزء ${k + 1} نجح`, upRes.ok, `→ ${upRes.status}`);
  }
  const mixedProc = await jfetch(`/api/jobs/${mixedId}/process`, { method: "POST" });
  check("الدمج المختلط نجح", mixedProc.status === 200 && mixedProc.body?.status === "done", JSON.stringify(mixedProc.body ?? {}).slice(0, 160));
  const mixedVid = await fetch(`${BASE}/api/jobs/${mixedId}/video`);
  const mixedBuf = Buffer.from(await mixedVid.arrayBuffer());
  check("ناتج الدمج المختلط يُبث كاملًا", mixedVid.status === 200 && mixedBuf.length === mixedProc.body.size);

  // 5) أخطاء متوقعة
  console.log("[5] رسائل الأخطاء والأكواد الصحيحة");
  const one = await jfetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos: [url1] }) });
  check("مقطع واحد → 400 برسالة عربية", one.status === 400 && /مقطع/.test(one.body?.error ?? ""));
  const eleven = await jfetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos: Array.from({ length: 11 }, () => url1) }) });
  check("أكثر من 10 → 400", eleven.status === 400);
  const badUrl = await jfetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos: [url1, "ftp://nope/x.mp4"] }) });
  check("رابط غير http → 400", badUrl.status === 400);
  const malformed = await fetch(`${BASE}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{تالف" });
  check("JSON تالف → 400", malformed.status === 400);
  const nf = await jfetch("/api/jobs/nonexistent123");
  check("مهمة غير موجودة → 404", nf.status === 404);
  const wrongMethod = await jfetch("/api/jobs/" + jobId, { method: "PUT" });
  check("طريقة خاطئة → 405", wrongMethod.status === 405);
  const incompleteProc = await jfetch(`/api/jobs/${jobId}/process`, { method: "POST" });
  check("استدعاء process على مهمة done يعيد النتيجة مجددًا (200)", incompleteProc.status === 200 && incompleteProc.body?.status === "done");

  // 6) الحذف الشامل ثم 404
  console.log("[6] الحذف الشامل");
  const del = await jfetch(`/api/jobs/${jobId}`, { method: "DELETE" });
  check("DELETE يعمل", del.status === 200);
  const afterDel = await jfetch(`/api/jobs/${jobId}`);
  check("بعد الحذف → 404 (بما فيها نقطة الفيديو)", afterDel.status === 404);
  const vidAfterDel = await fetch(`${BASE}/api/jobs/${jobId}/video`);
  check("بث الفيديو بعد الحذف → 404", vidAfterDel.status === 404);
  const del2 = await jfetch(`/api/jobs/${mixedId}`, { method: "DELETE" });
  check("حذف المهمة المختلطة", del2.status === 200);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n=== النتيجة: ${pass} نجح / ${fail} فشل ===`);
  process.exit(fail ? 1 : 0);

  function spawnFfmpeg(dest) {
    const { spawnSync } = require("child_process");
    const FFMPEG = require("ffmpeg-static");
    const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=600:duration=2", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", dest], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("ffmpeg فشل: " + r.stderr?.slice(-300));
  }
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
