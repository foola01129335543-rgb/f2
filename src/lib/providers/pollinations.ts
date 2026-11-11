// =============================================================================
// مزود Pollinations — «المفتاح المجاني التلقائي» للصور فقط (بدون أي مفتاح)
// GET https://image.pollinations.ai/prompt/{prompt}?width=&height=&model=flux
// يعمل بلا تسجيل وبلا رصيد — حد استخدام مجهول محدود (429 عند الازدحام → مؤقت
// ويُعاد المحاولة لاحقًا). يُستخدم كمرجع أخير بعد كل المفاتيح المدفوعة.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ProviderError, type CheckResult, type ProviderAdapter } from "./types";
import type { KeyRow } from "@/lib/turso";
import { insertMediaBlob } from "@/lib/turso";

const BASE = process.env.POLLINATIONS_BASE || "https://image.pollinations.ai/prompt";

function mediaBaseUrl(): string {
  return (
    process.env.MEDIA_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

/** أبعاد مدعومة بحسب نسبة الأبعاد المطلوبة */
const DIMS: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "3:2": [1216, 832],
  "2:3": [832, 1216],
};

export const pollinationsAdapter: ProviderAdapter = {
  async createImageSync(key, input) {
    const [w, h] = DIMS[input.aspect_ratio ?? "1:1"] ?? DIMS["1:1"];
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = `${BASE}/${encodeURIComponent(input.prompt)}?width=${w}&height=${h}&model=flux&nologo=true&seed=${seed}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(150_000) });
    } catch (e: unknown) {
      throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new ProviderError(res.status, `pollinations: ${String(msg).slice(0, 200)}`);
    }
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!mime.startsWith("image/")) {
      throw new ProviderError(502, `pollinations: استجابة غير متوقعة (${mime})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new ProviderError(502, "pollinations: استجابة فارغة");
    const id = randomUUID();
    await insertMediaBlob({ id, mime, data: buf.toString("base64") });
    return { urls: [`${mediaBaseUrl()}/api/media/${id}`] };
  },

  // الفيديو غير مدعوم في الخدمة المجانية — لا يُستدعى أصلًا (نموذج الفيديو لا يذكر pollinations)
  async createTask() {
    throw new ProviderError(501, "pollinations: للصور فقط");
  },

  async checkTask(): Promise<CheckResult> {
    throw new ProviderError(501, "pollinations: للصور المتزامنة فقط");
  },
};
