// =============================================================================
// GET /api/cron — حذف المهام المنتهية (Cron يومي في vercel.json)
// =============================================================================
const { json } = require("../lib/http");
const { deleteExpiredJobs } = require("../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { error: "طريقة غير مسموحة — استخدم GET" });
  try {
    const deleted = await deleteExpiredJobs();
    json(res, 200, { ok: true, deleted });
  } catch (e) {
    json(res, 500, { error: `فشل التنظيف: ${e.message}` });
  }
};
