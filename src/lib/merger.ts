// =============================================================================
// عميل خدمة دمج الفيديو — Video Merger API v2
// بلا مفاتيح أو توثيق — العنوان من MERGER_API_BASE. مخرجات MP4 (H.264+AAC)
// حتى 1080p بجودة CRF 18، وبلا معاملات resolution/fps (الناتج ثابت).
// قيود: 10 مقاطع كحد أقصى، 200MB/مصدر، 150MB ناتج، 600 ثانية، وحذف تلقائي بعد 24 ساعة.
// =============================================================================
import { ProviderError } from "@/lib/providers/types";

export const MERGER_BASE = (process.env.MERGER_API_BASE || "https://xxxxxxxx").replace(/\/+$/, "");

export const MERGER_LIMITS = {
  maxClips: 10,
  maxSourceMB: 200,
  maxOutputMB: 150,
  maxTotalDurationSec: 600,
};

export interface MergerJobInfo {
  jobId: string;
  status: "queued" | "uploading" | "processing" | "done" | "failed";
  progress: number; // 0..100
  videoUrl?: string;
  downloadUrl?: string;
  error?: string;
  expiresAt?: string;
  raw?: unknown;
}

async function mergerFetch(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<{ status: number; body: any }> {
  let res: Response;
  try {
    res = await fetch(`${MERGER_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: unknown) {
    // أخطاء شبكتنا نحن (timeout/fetch) = مؤقتة — تُبلَّغ بحالة 0 ليُعاملها المستدعي وفقًا لذلك
    throw new ProviderError(0, `merger network error: ${(e as Error)?.message ?? e}`);
  }
  const body = await res.json().catch(() => ({} as any));
  return { status: res.status, body };
}

/** تحليل الحالة دفاعيًا: قد يرد الجسم فيه error بلا status → failed فورًا (قسم 7.2) */
function parseJobInfo(jobId: string, body: any): MergerJobInfo {
  const rawStatus = String(body?.status ?? "").toLowerCase();
  const completed = ["done", "completed", "complete", "success", "succeeded", "finished"].includes(rawStatus);
  const failed = ["error", "failed", "failure", "cancelled", "canceled"].includes(rawStatus);

  // progress يأتي أحيانًا كسرًا 0..1 → اضربه في 100
  let progress = Number(body?.progress ?? 0);
  if (!Number.isFinite(progress) || progress < 0) progress = 0;
  if (progress <= 1 && progress > 0 && !Number.isInteger(progress)) progress = progress * 100;
  progress = Math.min(Math.max(Math.round(progress), 0), 100);

  // رابط النتيجة: فضّل videoUrl ثم downloadUrl، وإن غابا فاضبطه من jobId
  let videoUrl: string | undefined = typeof body?.videoUrl === "string" && body.videoUrl ? body.videoUrl : undefined;
  const downloadUrl: string | undefined =
    typeof body?.downloadUrl === "string" && body.downloadUrl ? body.downloadUrl : undefined;
  if (!videoUrl && !downloadUrl && completed) videoUrl = `${MERGER_BASE}/api/jobs/${jobId}/video`;

  const errorMsg = typeof body?.error === "string" && body.error ? body.error : undefined;

  let status: MergerJobInfo["status"];
  if (failed || (!rawStatus && errorMsg)) status = "failed";
  else if (completed) status = "done";
  else if (["queued", "uploading", "processing"].includes(rawStatus)) status = rawStatus as MergerJobInfo["status"];
  else status = "processing";

  if (status === "failed" && !errorMsg) status = "processing"; // بلا رسالة خطأ صريحة لا نحكم بالفشل

  return {
    jobId,
    status,
    progress: status === "done" ? 100 : progress,
    videoUrl,
    downloadUrl,
    error: errorMsg,
    expiresAt: body?.expiresAt,
    raw: body,
  };
}

export async function mergerHealthy(): Promise<boolean> {
  try {
    const { status } = await mergerFetch("/api/config", { method: "GET" }, 4_000);
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}

export async function createMergeJob(videos: string[]): Promise<{ jobId: string; statusUrl?: string }> {
  const { status, body } = await mergerFetch("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ videos }),
  });
  if (status < 200 || status >= 300) {
    // أي خطأ معلن من الخدمة (4xx/5xx بجسم error) = فشل نهائي فوري — لا إعادة محاولة (قاعدة حتمية)
    throw new ProviderError(status, String(body?.error ?? `merger HTTP ${status}`));
  }
  const jobId = String(body?.jobId ?? "");
  if (!jobId) throw new ProviderError(500, "merger: استجابة إنشاء المهمة بلا jobId");
  return { jobId, statusUrl: body?.statusUrl };
}

/**
 * تنفيذ الدمج — يُطلق مرة واحدة فقط لكل مهمة (حماية بقفل في الذاكرة
 * حتى لا يتزامن مع get_task ويُنفَّذ مرتين).
 */
const processInFlight = new Set<string>();

export async function processMergeJob(jobId: string): Promise<MergerJobInfo | null> {
  if (processInFlight.has(jobId)) return null; // جارٍ التنفيذ بالفعل في طلب آخر
  processInFlight.add(jobId);
  try {
    const { status, body } = await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}/process`, {
      method: "POST",
      body: "{}",
    }, 320_000); // الدمج يستغرق ~10–15 ثانية محليًا وقد يطول مع الملفات الكبيرة
    if (status === 202) return null; // قيد المعالجة بالفعل
    if (status < 200 || status >= 300) {
      throw new ProviderError(status, String(body?.error ?? `merger HTTP ${status}`));
    }
    return parseJobInfo(jobId, { status: "done", ...body });
  } finally {
    processInFlight.delete(jobId);
  }
}

export async function getMergeJob(jobId: string): Promise<MergerJobInfo> {
  const { status, body } = await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
  if (status === 404) {
    const e = new ProviderError(404, "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)");
    (e as ProviderError & { mergerNotFound?: boolean }).mergerNotFound = true;
    throw e;
  }
  if (status < 200 || status >= 300) {
    throw new ProviderError(status, String(body?.error ?? `merger HTTP ${status}`));
  }
  return parseJobInfo(jobId, body);
}

export async function deleteMergeJob(jobId: string): Promise<void> {
  try {
    await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  } catch { /* التنظيف اختياري — نتجاهل أخطاءه */ }
}
