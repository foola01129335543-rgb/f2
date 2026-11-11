// =============================================================================
// خدمة الوسائط المخزنة — GET /api/media/[id]
// تُخدِم الصور المولّدة من مزود Google (base64 مخزّن في Turso media_blobs)
// روابط دائمة عامة تصلح لنتائج MCP والدمج والعرض
// =============================================================================
import type { NextApiRequest, NextApiResponse } from "next";
import { getMediaBlob } from "@/lib/turso";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "طريقة غير مسموحة" });
    return;
  }
  const id = String(req.query.id ?? "").trim();
  if (!id || !/^[0-9a-fA-F-]{8,64}$/.test(id)) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  try {
    const blob = await getMediaBlob(id);
    if (!blob) {
      res.status(404).json({ error: "الوسيط غير موجود" });
      return;
    }
    const buf = Buffer.from(blob.data, "base64");
    res.setHeader("Content-Type", blob.mime);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200);
    if (req.method === "HEAD") { res.end(); return; }
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: `خطأ في جلب الوسيط: ${e instanceof Error ? e.message : e}` });
  }
}
