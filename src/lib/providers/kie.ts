// =============================================================================
// مزود kie.ai — Jobs API الموحد (الأشكال الحقيقية المقاسة عمليًا):
// createTask → {"code":200,"msg":"success","data":{"taskId":"..."}}
// recordInfo → {"code":200,"data":{"state":"waiting|queuing|generating|success|fail",
//               "resultJson":"{\"resultUrls\":[\"https://...\"]}",  // نص JSON داخل JSON
//               "failMsg":"..."}}
// =============================================================================
import { ProviderError, type CheckResult, type ProviderAdapter } from "./types";
import type { KeyRow } from "@/lib/turso";

const BASE = "https://api.kie.ai/api/v1/jobs";

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
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: unknown) {
    // انقطاع شبكة/timeout → خطأ مؤقت
    throw new ProviderError(0, `network error: ${(e as Error)?.message ?? e}`);
  }

  const body = await res.json().catch(() => ({} as any));
  const msg: string = String(body?.msg ?? body?.message ?? res.statusText ?? "unknown error");
  // kie يعيد الحالة داخل الجسم (code) وأحيانًا في HTTP status — نوحّدهما في ProviderError
  if (!res.ok) throw new ProviderError(res.status, msg);
  if (body?.code !== undefined && body.code !== 200) throw new ProviderError(Number(body.code), msg);
  return body;
}

export const kieAdapter: ProviderAdapter = {
  async createTask(key, model, input) {
    const body = await callApi(key, "/createTask", {
      method: "POST",
      body: JSON.stringify({ model, input }),
    });
    const taskId = body?.data?.taskId;
    if (!taskId) throw new ProviderError(500, "kie: استجابة createTask بلا taskId");
    return { providerTaskId: String(taskId) };
  },

  async checkTask(key, providerTaskId): Promise<CheckResult> {
    const body = await callApi(key, `/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`);
    const d = body?.data ?? {};
    const state: string = String(d.state ?? "waiting");

    if (state === "success") {
      // resultJson نص JSON داخل JSON يحتاج JSON.parse ثانيًا
      let urls: string[] = [];
      try {
        const parsed = JSON.parse(String(d.resultJson ?? "{}"));
        urls = Array.isArray(parsed?.resultUrls) ? parsed.resultUrls.map(String) : [];
      } catch { /* نتجاهل التحليل الفاشل — نعاملها كنتيجة فارغة */ }
      if (!urls.length) return { status: "failed", error: "اكتملت المهمة لدى المزود دون روابط نتائج" };
      return { status: "completed", urls };
    }

    if (state === "fail") {
      return { status: "failed", error: String(d.failMsg ?? d.failCode ?? "فشل التوليد لدى المزود") };
    }

    // تقدير تقدم تقريبي (kie لا يعيد progress لهذه الموديلات): waiting<queuing<generating
    const progress = state === "queuing" ? 20 : state === "generating" ? 55 : 10;
    return { status: "processing", progress };
  },
};
