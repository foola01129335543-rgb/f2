// =============================================================================
// مزود Google (Gemini API) — للصور فقط
// المفاتيح: صيغة Google AI Studio الجديدة (AQ.) — تُرسَل في ترويسة x-goog-api-key
// (المفاتيح الجديدة لا تعمل بصيغة ?key= في الرابط — انظر تغيّر سبتمبر 2026)
//
// الصور متزامنة عبر :generateContent وتعود inlineData (base64) — نحفظها في
// جدول media_blobs في Turso ونخدمها عبر /api/media/[id] كرابط عام دائم.
// ملاحظة: مفاتيح Google المجانية لا تضم نماذج الفيديو (Veo) — الفيديو يبقى عبر kie.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ProviderError, type CheckResult, type ProviderAdapter } from "./types";
import type { KeyRow } from "@/lib/turso";
import { insertMediaBlob } from "@/lib/turso";

const BASE = process.env.GOOGLE_API_BASE || "https://generativelanguage.googleapis.com/v1beta";

/** الرابط العام الذي سُتخدمَم من خدمة الصور المخزنة (/api/media/[id]) */
function mediaBaseUrl(): string {
  return (
    process.env.MEDIA_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

/** نسبة الأبعاد المدعومة في imageConfig — غير المدعومة تُهمَل (auto) */
function aspectRatioOrNull(aspect?: string): string | null {
  const supported = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
  return aspect && supported.includes(aspect) ? aspect : null;
}

interface GooglePart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

async function generateImage(key: KeyRow, model: string, input: { prompt: string; aspect_ratio?: string }): Promise<{ mime: string; base64: string }> {
  const aspect = aspectRatioOrNull(input.aspect_ratio);
  const buildBody = (withImageConfig: boolean) => ({
    contents: [{ parts: [{ text: input.prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(withImageConfig && aspect ? { imageConfig: { aspectRatio: aspect } } : {}),
    },
  });

  const headers = { "x-goog-api-key": key.api_key, "Content-Type": "application/json" };

  let res: Response;
  try {
    res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(true)),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e: unknown) {
    throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
  }

  let body: any = await res.json().catch(() => ({} as any));

  // بعض النماذج لا تدعم imageConfig — نعيد المحاولة بلا نسبة أبعاد
  if (!res.ok && res.status === 400 && aspect && /imageconfig|aspect|aspectratio/i.test(String(body?.error?.message ?? ""))) {
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(false)),
        signal: AbortSignal.timeout(120_000),
      });
      body = await res.json().catch(() => ({} as any));
    } catch (e: unknown) {
      throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
    }
  }

  if (!res.ok) {
    const msg = String(body?.error?.message ?? res.statusText ?? "unknown error");
    throw new ProviderError(res.status, msg);
  }

  const block = body?.promptFeedback?.blockReason;
  if (block) throw new ProviderError(400, `google: تم حجب الطلب (${block})`);

  const parts: GooglePart[] = body?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p) => p.inlineData?.data);
  if (!imgPart?.inlineData?.data) {
    const finish = String(body?.candidates?.[0]?.finishReason ?? "unknown");
    throw new ProviderError(502, `google: استجابة بلا صورة (finishReason: ${finish})`);
  }
  return { mime: String(imgPart.inlineData.mimeType ?? "image/png"), base64: String(imgPart.inlineData.data) };
}

export const googleAdapter: ProviderAdapter = {
  // صور متزامنة — تُستدعى مباشرة من منسّق التوليد
  async createImageSync(key, input) {
    const model = process.env.GOOGLE_IMAGE_MODEL || "gemini-2.5-flash-image";
    const { mime, base64 } = await generateImage(key, model, input);
    const id = randomUUID();
    await insertMediaBlob({ id, mime, data: base64 });
    return { urls: [`${mediaBaseUrl()}/api/media/${id}`] };
  },

  // الفيديو غير مدعوم عبر مفاتيح Google المجانية — لا تُستدعى أصلًا (نموذج الفيديو لا يذكر google)
  async createTask() {
    throw new ProviderError(501, "google: توليد الفيديو غير مدعوم عبر مفاتيح Gemini المجانية");
  },

  async checkTask(): Promise<CheckResult> {
    throw new ProviderError(501, "google: لا مهام غير متزامنة — الصور متزامنة");
  },
};
