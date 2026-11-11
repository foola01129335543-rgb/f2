// =============================================================================
// محرك الدمج — ffmpeg + ffprobe داخل الدالة نفسها
// - توحيد كل المصادر: scale + pad إلى أكبر دقة (حد 1920×1080 أبعاد زوجية)،
//   fps=30، setsar=1، format=yuv420p ثم concat=n=:v=1:a=1
// - مصدر بلا صوت → مسار صامت anullsrc بنفس مدته بدل أن يفشل الدمج
// - الترميز: libx264 CRF 18 + AAC 192k/44100 + +faststart (MP4 عالي الجودة)
// - التقدم من -progress pipe:1 (out_time_us) → 40-90 من النطاق الكلي
// =============================================================================
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");

const FFMPEG_BIN = require("ffmpeg-static");
const FFPROBE_BIN = require("ffprobe-static").path;

const LIMITS = {
  maxSources: Number(process.env.MAX_SOURCES ?? 10),
  sourceMaxBytes: Number(process.env.SOURCE_MAX_MB ?? 200) * 1024 * 1024,
  outputMaxBytes: Number(process.env.OUTPUT_MAX_MB ?? 150) * 1024 * 1024,
  maxTotalDurationSec: Number(process.env.MAX_TOTAL_DURATION_SEC ?? 600),
  preset: process.env.FFMPEG_PRESET ?? "medium",
};

/** ثنائي ffmpeg قد يفقد صلاحية التنفيذ في الاستضافة — نسخة إلى /tmp بصلاحية 755 عند الحاجة */
async function ensureExecutable(binPath) {
  const tmp = path.join(os.tmpdir(), path.basename(binPath));
  try {
    await fsp.access(tmp, fs.constants.X_OK);
    return tmp;
  } catch {
    await fsp.copyFile(binPath, tmp);
    await fsp.chmod(tmp, 0o755);
    return tmp;
  }
}

function run(cmd, args, { onStdoutLine, captureStderr = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", captureStderr ? "pipe" : "ignore"] });
    let stderr = "";
    let stdoutBuf = "";
    child.stdout.on("data", (d) => {
      if (!onStdoutLine) return;
      stdoutBuf += d.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) onStdoutLine(line.trim());
    });
    if (captureStderr) child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ code, stderr }) : reject(Object.assign(new Error(`ffmpeg/ffprobe exit ${code}: ${stderr.split("\n").slice(-6).join(" | ")}`), { code, stderr }))));
  });
}

/** فحص مصدر: الدقة، معدل الإطارات، المدة، وجود صوت (JSON من ffprobe stdout) */
async function ffprobeFile(file) {
  const bin = await ensureExecutable(FFPROBE_BIN);
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(bin, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d.slice(0, 2000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`ffprobe exit ${code}: ${err.slice(-400)}`))));
  });
  const j = JSON.parse(raw);
  const v = (j.streams ?? []).find((s) => s.codec_type === "video");
  const a = (j.streams ?? []).find((s) => s.codec_type === "audio");
  const duration = Number(j.format?.duration ?? v?.duration ?? 0);
  const fps = v?.avg_frame_rate && v.avg_frame_rate.includes("/") ? Number(v.avg_frame_rate.split("/")[0]) / Number(v.avg_frame_rate.split("/")[1] || 1) : Number(v?.avg_frame_rate ?? 30);
  if (!v) throw new Error("المصدر لا يحتوي مسار فيديو صالحًا");
  return {
    width: Number(v.width), height: Number(v.height),
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    duration,
    hasAudio: Boolean(a),
  };
}

/** أبعاد الهدف: أكبر دقة بين المدخلات بحد 1920×1080 وبأبعاد زوجية */
function targetDims(probes) {
  const w = Math.min(Math.max(...probes.map((p) => p.width)), 1920);
  const h = Math.min(Math.max(...probes.map((p) => p.height)), 1080);
  return { w: w - (w % 2 || 0) || w, h: h - (h % 2 || 0) || h };
}

/**
 * الدمج الكامل: مواد المصادر في tmpPaths → مخرج MP4 في outPath
 * onProgress(percent 0..100)
 */
async function mergeVideos({ tmpPaths, outPath, onProgress }) {
  const probes = [];
  for (const p of tmpPaths) probes.push(await ffprobeFile(p));

  const totalDuration = probes.reduce((s, p) => s + p.duration, 0);
  if (totalDuration > LIMITS.maxTotalDurationSec) {
    throw new Error(`مجموع مدد المقاطع (${Math.round(totalDuration)} ثانية) يتجاوز الحد المسموح (${LIMITS.maxTotalDurationSec} ثانية)`);
  }

  const { w, h } = targetDims(probes);
  const args = ["-y", "-hide_banner"];
  const filters = [];
  let inputIdx = 0;
  const pairs = []; // {videoIdx, audioIdx|null}

  for (let i = 0; i < tmpPaths.length; i++) {
    const p = probes[i];
    args.push("-i", tmpPaths[i]);
    const videoIdx = inputIdx++;
    let audioIdx = null;
    if (p.hasAudio) {
      audioIdx = videoIdx; // نفس المدخل يحتوي الصوت
    } else {
      // مسار صامت بنفس مدة المصدر
      args.push("-f", "lavfi", "-t", String(Math.max(p.duration, 0.04)), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
      audioIdx = inputIdx++;
    }
    pairs.push({ videoIdx, audioIdx });
    filters.push(`[${videoIdx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[v${i}]`);
    filters.push(`[${audioIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`);
  }

  const concatIn = pairs.map((_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${concatIn}concat=n=${tmpPaths.length}:v=1:a=1[vout][aout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-crf", "18", "-preset", LIMITS.preset,
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
    "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    "-f", "mp4", outPath
  );

  const ffmpeg = await ensureExecutable(FFMPEG_BIN);
  await run(ffmpeg, args, {
    onStdoutLine: (line) => {
      if (!onProgress) return;
      const m = line.match(/^out_time_us=(\d+)/);
      if (m && totalDuration > 0) {
        const sec = Number(m[1]) / 1_000_000;
        const ratio = Math.min(Math.max(sec / totalDuration, 0), 1);
        onProgress(Math.round(40 + ratio * 50)); // 40-90 أثناء الترميز
      }
    },
  });
  return { width: w, height: h, totalDuration };
}

/** تنزيل مصدر رابط إلى ملف مع عدّاد بايتات وحد حجم */
async function downloadToFile(url, destPath, onProgress) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`فشل تنزيل المصدر (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let written = 0;
  const file = fs.createWriteStream(destPath);
  // جسم fetch هو Web ReadableStream — نحوّله إلى تدفق Node
  const { Readable } = require("stream");
  const nodeStream = Readable.fromWeb(res.body);
  await new Promise((resolve, reject) => {
    nodeStream.on("data", (chunk) => {
      written += chunk.length;
      if (written > LIMITS.sourceMaxBytes) {
        nodeStream.destroy();
        file.destroy();
        reject(new Error(`حجم المصدر يتجاوز الحد المسموح (${Math.round(LIMITS.sourceMaxBytes / 1024 / 1024)}MB لكل مصدر)`));
        return;
      }
      file.write(chunk);
      if (onProgress && total > 0) onProgress(written / total);
    });
    nodeStream.on("end", () => file.end());
    nodeStream.on("error", reject);
    file.on("error", reject);
    file.on("finish", resolve);
  });
  return written;
}

module.exports = { LIMITS, ensureExecutable, ffprobeFile, mergeVideos, downloadToFile, targetDims };
