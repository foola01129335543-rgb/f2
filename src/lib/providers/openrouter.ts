// =============================================================================
// مزود OpenRouter — صور متزامنة + فيديو غير متزامن (التوثيق الرسمي 2026)
// الصور:  POST /api/v1/images {model, prompt, n, aspect_ratio, ...}
//         → {"data":[{"b64_json":"...","media_type":"image/png"}]} — تُخزَّن في
//         media_blobs وتُخدَم عبر /api/media/[id] كرابط عام دائم.
// الفيديو: POST /api/v1/videos {model, prompt, duration, resolution, aspect_ratio}
//         → 202 {"id":"...","polling_url":"...","status":"pending"}
//         ثم GET /api/v1/videos/{id} → status: pending|in_progress|completed|failed
//         — عند الاكتمال تُفضَّل الروابط الموقعة urls[] (عامة بلا ترويسات)، وإلا
//           يُنزَّل المحتوى من unsigned_urls[0] (يتطلب المفتاح) ويُخزَّن محليًا.
// الرصيد: النماذج المدفوعة تتطلب رصيدًا في حساب OpenRouter — النفاد يعيد 402
//         فيُصنَّف exhausted ويُتابع بالمفتاح التالي تلقائيًا.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ProviderError, type CheckResult, type ProviderAdapter, type VideoInput } from "./types";
import type { KeyRow } from "@/lib/turso";
import { insertMediaBlob } from "@/lib/turso";

const BASE = process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";

/** الرابط العام الذي سُتخدمَم من خدمة الوسائط المخزنة (/api/media/[id]) */
function mediaBaseUrl(): string {
  return (
    process.env.MEDIA_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

async function callApi(key: KeyRow, path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key.api_key}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e: unknown) {
    throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
  }
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = String(
      body?.error?.message ?? body?.error?.metadata?.raw ?? body?.message ?? res.statusText ?? "unknown error"
    );
    throw new ProviderError(res.status, msg);
  }
  return body;
}

/** تخزين وسيط base64 في Turso وإعادة رابطه العام الدائم */
async function storeBlob(mime: string, base64: string): Promise<string> {
  const id = randomUUID();
  await insertMediaBlob({ id, mime, data: base64 });
  return `${mediaBaseUrl()}/api/media/${id}`;
}

export const openRouterAdapter: ProviderAdapter = {
  // صور متزامنة — تعيد base64 دائمًا
  async createImageSync(key, input) {
    const model = process.env.OPENROUTER_IMAGE_MODEL || "openai/gpt-image-2.6-flare";
    const body = await callApi(key, "/images", {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        n: 1,
        ...(input.aspect_ratio && input.aspect_ratio !== "auto" ? { aspect_ratio: input.aspect_ratio } : {}),
        ...(input.resolution ? { resolution: input.resolution } : {}),
        ...(input.output_format ? { output_format: input.output_format } : {}),
        ...(input.background && input.background !== "auto" ? { background: input.background } : {}),
      }),
    });
    const items: any[] = Array.isArray(body?.data) ? body.data : [];
    const first = items.find((d) => typeof d?.b64_json === "string" && d.b64_json);
    if (!first) throw new ProviderError(502, "openrouter: استجابة الصور بلا بيانات");
    const mime = String(first.media_type ?? "image/png");
    const url = await storeBlob(mime, String(first.b64_json));
    return { urls: [url] };
  },

  // فيديو غير متزامن — يعيد معرّف المهمة ويُتْبع عبر checkTask
  async createTask(key, model, input) {
    const v = input as VideoInput;
    const body = await callApi(key, "/videos", {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: v.prompt,
        ...(v.duration ? { duration: Math.max(1, Math.min(20, Math.round(v.duration))) } : {}),
        ...(v.aspect_ratio && v.aspect_ratio !== "auto" ? { aspect_ratio: v.aspect_ratio } : {}),
        resolution: v.resolution || process.env.OPENROUTER_VIDEO_RESOLUTION || "480p",
        generate_audio: typeof v.enable_audio === "boolean" ? v.enable_audio : true,
        ...(v.image_url
          ? { frame_images: [{ type: "image_url", image_url: { url: v.image_url }, frame_type: "first_frame" }] }
          : {}),
      }),
    });
    const jobId = body?.id ?? body?.job_id;
    if (!jobId) throw new ProviderError(500, "openrouter: استجابة إنشاء الفيديو بلا معرّف");
    return { providerTaskId: String(jobId) };
  },

  async checkTask(key, providerTaskId): Promise<CheckResult> {
    const body = await callApi(key, `/videos/${encodeURIComponent(providerTaskId)}`, { method: "GET" });
    const status = String(body?.status ?? "").toLowerCase();

    if (status === "completed") {
      // 1) روابط موقعة عامة (بلا ترويسات) — الأفضل
      const signed: string[] = Array.isArray(body?.urls)
        ? body.urls.filter((u: unknown) => typeof u === "string" && u)
        : [];
      if (signed.length) return { status: "completed", urls: signed.map(String) };
      // 2) لا روابط موقعة — ننزّل المحتوى بأنفسنا (يتطلب المفتاح) ونخزّنه محليًا
      const unsigned: string =
        Array.isArray(body?.unsigned_urls) && typeof body.unsigned_urls[0] === "string"
          ? body.unsigned_urls[0]
          : "";
      if (!unsigned) return { status: "failed", error: "اكتملت المهمة لدى OpenRouter دون روابط نتائج" };
      let res: Response;
      try {
        res = await fetch(unsigned, {
          headers: { Authorization: `Bearer ${key.api_key}` },
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e: unknown) {
        throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
      }
      if (!res.ok) throw new ProviderError(res.status, `openrouter: فشل تنزيل الفيديو (${res.status})`);
      const rawMime = res.headers.get("content-type") ?? "video/mp4";
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new ProviderError(502, "openrouter: تنزيل الفيديو أعاد محتوى فارغًا");
      const url = await storeBlob(rawMime.startsWith("video/") ? rawMime.split(";")[0] : "video/mp4", buf.toString("base64"));
      return { status: "completed", urls: [url] };
    }

    if (status === "failed" || status === "cancelled" || status === "expired") {
      const err = body?.error;
      const msg = typeof err === "string" ? err : String(err?.message ?? err?.code ?? "فشل التوليد لدى OpenRouter");
      return { status: "failed", error: msg };
    }

    // pending | in_progress
    return { status: "processing", progress: status === "in_progress" ? 50 : 10 };
  },
};
