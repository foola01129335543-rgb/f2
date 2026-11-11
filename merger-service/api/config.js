// =============================================================================
// GET /api/config — الحدود العامة + version (تُستخدم لفحص الجهوزية)
// =============================================================================
const { json } = require("../lib/http");
const { LIMITS } = require("../lib/merge");
const { CHUNK_SIZE } = require("../lib/storage");
const { readJsonBody } = require("../lib/http");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { json(res, 200, {}); return; }
  if (req.method !== "GET") return json(res, 405, { error: "طريقة غير مسموحة — استخدم GET" });
  void readJsonBody;
  json(res, 200, {
    version: "1.0.0",
    limits: {
      maxSources: LIMITS.maxSources,
      sourceMaxMB: Math.round(LIMITS.sourceMaxBytes / 1024 / 1024),
      outputMaxMB: Math.round(LIMITS.outputMaxBytes / 1024 / 1024),
      maxTotalDurationSec: LIMITS.maxTotalDurationSec,
      uploadChunkBytes: 4 * 1024 * 1024,
      storageRowBytes: CHUNK_SIZE,
      ffmpegPreset: LIMITS.preset,
    },
    retentionHours: 24,
  });
};
