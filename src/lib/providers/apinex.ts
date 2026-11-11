// =============================================================================
// مزود APInex (apinex.bond) — المزود الأول للصور بدلًا من kie.ai بناءً على طلب المالك:
// - صور متزامنة عبر نقطة متوافقة مع OpenAI (تعيد النتيجة فورًا):
//     POST https://api.apinex.bond/v1/images/generations
//     {model: "gpt-image-2.6-flare", prompt, n: 1, size}
// - الفيديو غير مدعوم لدى APInex إطلاقًا (مسار /v1/videos غير موجود — تم فحصه فعليًا)
// - الرصيد محفظة دولار واحدة: GET /v1/balance → {balance_usd, reserved_usd, rpm}
//   نفاد الرصيد يعيد 402 insufficient_quota ويصنَّف exhausted تلقائيًا،
//   وبعد شحن الحساب يعود المفتاح active فور أول توليد ناجح (منطق قائم في المنسّق).
// =============================================================================
import { ProviderError, type CheckResult, type CreateTaskResult, type ImageInput, type ProviderAdapter } from "./types";
import type { KeyRow } from "@/lib/turso";

const BASE = process.env.APINEX_BASE || "https://api.apinex.bond";

function authHeaders(key: KeyRow): Record<string, string> {
  return { Authorization: `Bearer ${key.api_key}`, "Content-Type": "application/json" };
}

async function throwProviderError(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({} as any));
  const msg = String(
    body?.error?.message ?? body?.message ?? body?.error ?? res.statusText ?? "unknown error",
  );
  throw new ProviderError(res.status, `apinex: ${msg}`);
}

/** تحويل نسبة الأبعاد إلى أحجام gpt-image المتوافقة مع OpenAI */
function aspectToSize(aspect?: string): string {
  switch (aspect) {
    case "1:1": return "1024x1024";
    case "auto": return "auto";
    case "3:2": case "4:3": case "16:9": case "5:4": case "21:9": case "3:1": case "2:1":
      return "1536x1024";
    default:
      return "1024x1536";
  }
}

export const apinexAdapter: ProviderAdapter = {
  // صور متزامنة — تُستدعى مباشرة من منسّق التوليد قبل أي مسار غير متزامن
  async createImageSync(key, input: ImageInput, model?) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/images/generations`, {
        method: "POST",
        headers: authHeaders(key),
        body: JSON.stringify({
          model: model || "gpt-image-2.6-flare",
          prompt: input.prompt,
          n: 1,
          size: aspectToSize(input.aspect_ratio),
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e: unknown) {
      throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
    }
    if (!res.ok) await throwProviderError(res);
    const body = await res.json().catch(() => ({} as any));
    const items: any[] = Array.isArray(body?.data) ? body.data : [];
    const urls = items
      .map((d) => (typeof d?.url === "string" && d.url
        ? d.url
        : typeof d?.b64_json === "string" && d.b64_json
          ? `data:image/png;base64,${d.b64_json}`
          : null))
      .filter((u): u is string => Boolean(u));
    if (!urls.length) throw new ProviderError(500, "apinex: استجابة الصور بلا روابط");
    return { urls };
  },

  // APInex لا يوفر مهامًا غير متزامنة — لا يُدرج في سلاسل الفيديو أصلًا (models.ts)
  async createTask(): Promise<CreateTaskResult> {
    throw new ProviderError(501, "apinex: لا يدعم المهام غير المتزامنة (الصور متزامنة والفيديو غير مدعوم)");
  },

  async checkTask(): Promise<CheckResult> {
    throw new ProviderError(501, "apinex: لا يدعم المهام غير المتزامنة (الصور متزامنة والفيديو غير مدعوم)");
  },
};
