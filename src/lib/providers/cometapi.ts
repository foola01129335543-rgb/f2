// =============================================================================
// مزود CometAPI (المزود الثاني):
// - صور متزامنة عبر نقطة images المتوافقة مع OpenAI (تعيد الرابط فورًا):
//     POST https://api.cometapi.com/v1/images/generations {model, prompt, n, size}
// - فيديو عبر نقطة مهام غير متزامنة بنفس نمط create/check.
// ملاحظة: مسارات الفيديو قابلة للتجاوز بمتغيرات البيئة إذا تغيّر التوثيق الرسمي،
// وتحليل الاستجابات دفاعي (يدعم id/task_id/data.taskId وغيرها) بحسب توثيق api.cometapi.com.
// =============================================================================
import { ProviderError, type CheckResult, type ProviderAdapter } from "./types";
import type { KeyRow } from "@/lib/turso";

const BASE = process.env.COMETAPI_BASE || "https://api.cometapi.com";
const VIDEO_CREATE_URL = process.env.COMETAPI_VIDEO_CREATE_URL || `${BASE}/v1/videos/creations`;
const VIDEO_QUERY_URL = process.env.COMETAPI_VIDEO_QUERY_URL || `${BASE}/v1/videos/status`;

function authHeaders(key: KeyRow): Record<string, string> {
  return { Authorization: `Bearer ${key.api_key}`, "Content-Type": "application/json" };
}

async function throwProviderError(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({} as any));
  const msg = String(body?.error?.message ?? body?.message ?? body?.error ?? res.statusText ?? "unknown error");
  throw new ProviderError(res.status, msg);
}

/** تحويل نسبة الأبعاد إلى حجم OpenAI المتوافق */
function aspectToSize(aspect?: string): string {
  switch (aspect) {
    case "1:1": case "auto": return aspect === "1:1" ? "1024x1024" : "auto";
    case "3:2": case "4:3": case "16:9": case "5:4": case "21:9": case "3:1": case "2:1":
      return "1536x1024";
    default:
      return "1024x1536";
  }
}

export const cometApiAdapter: ProviderAdapter = {
  // صور متزامنة — تُستدعى مباشرة من منسّق التوليد عند توفرها
  async createImageSync(key, input) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/images/generations`, {
        method: "POST",
        headers: authHeaders(key),
        body: JSON.stringify({
          model: key.provider === "cometapi" ? undefined : undefined, // يُمرَّر من المنسّق عبر input نفسه
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
    if (!urls.length) throw new ProviderError(500, "cometapi: استجابة الصور بلا روابط");
    return { urls };
  },

  async createTask(key, model, input) {
    let res: Response;
    try {
      res = await fetch(VIDEO_CREATE_URL, {
        method: "POST",
        headers: authHeaders(key),
        body: JSON.stringify({ model, ...input }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: unknown) {
      throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
    }
    if (!res.ok) await throwProviderError(res);
    const body = await res.json().catch(() => ({} as any));
    const taskId =
      body?.taskId ?? body?.task_id ?? body?.id ?? body?.data?.taskId ?? body?.data?.task_id ?? body?.data?.id;
    if (!taskId) throw new ProviderError(500, "cometapi: استجابة إنشاء المهمة بلا معرّف");
    return { providerTaskId: String(taskId) };
  },

  async checkTask(key, providerTaskId): Promise<CheckResult> {
    let res: Response;
    const sep = VIDEO_QUERY_URL.includes("?") ? "&" : "?";
    try {
      res = await fetch(`${VIDEO_QUERY_URL}${sep}task_id=${encodeURIComponent(providerTaskId)}`, {
        headers: authHeaders(key),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: unknown) {
      throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
    }
    if (!res.ok) await throwProviderError(res);
    const body = await res.json().catch(() => ({} as any));
    const d = body?.data ?? body ?? {};
    const rawStatus = String(d?.status ?? d?.state ?? "").toLowerCase();
    const taskStatus = String(d?.task_status ?? "").toLowerCase();
    const status = rawStatus || taskStatus;

    const done = ["completed", "complete", "success", "succeeded", "done", "finished"].includes(status);
    const failed = ["failed", "error", "failure", "cancelled", "canceled"].includes(status);

    if (done) {
      const urls: string[] = [];
      const candidate = d?.video_url ?? d?.videoUrl ?? d?.url ?? d?.output?.video_url ?? d?.output?.url;
      if (typeof candidate === "string" && candidate) urls.push(candidate);
      if (Array.isArray(d?.output)) {
        for (const o of d.output) {
          if (typeof o === "string") urls.push(o);
          else if (typeof o?.url === "string") urls.push(o.url);
        }
      }
      if (!urls.length) return { status: "failed", error: "اكتملت المهمة لدى المزود دون روابط نتائج" };
      return { status: "completed", urls };
    }
    if (failed) return { status: "failed", error: String(d?.error?.message ?? d?.error ?? d?.failMsg ?? "فشل التوليد لدى المزود") };

    const progress = typeof d?.progress === "number" ? (d.progress <= 1 ? d.progress * 100 : d.progress) : undefined;
    return { status: "processing", progress };
  },
};
