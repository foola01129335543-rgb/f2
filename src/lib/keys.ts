// =============================================================================
// نظام المفاتيح — قلب المشروع
// 1) الترتيب التسلسلي الصارم حسب الإضافة (getKeyPool في turso.ts)
// 2) تصنيف موحّد لأخطاء المزود (جدول 4.2 في المواصفة)
// 3) إخفاء المفاتيح إلزامي في كل الاستجابات والسجلات (maskKey)
// =============================================================================
import { ProviderError } from "@/lib/providers/types";

export type ErrorClass = "disabled" | "exhausted" | "provider" | "params" | "temporary";

const RE_DISABLED = /(invalid api key|unauthorized|forbidden|authentication|auth key|api key is invalid|401|403)/i;
const RE_EXHAUSTED = /(insufficient|quota|balance|credit|out of credits|exhausted|充值|402)/i;
const RE_PROVIDER_MODEL = /(model not found|unsupported model|model does not exist|no such model)/i;

/**
 * تصنيف خطأ المزود حسب جدول 4.2:
 * - disabled  : مفتاح مرفوض → تعطيل تلقائي → التالي
 * - exhausted : نفاد رصيد (يُفحص قبل 400 لأن بعض المزودين يرسلونه بحالة 400) → التالي
 * - provider  : الموديل غير مدعوم لدى هذا المزود → التالي
 * - params    : خطأ في معطيات الطلب → توقف فورًا (تبديل المفاتيح لا يحلّه)
 * - temporary : 429/5xx/شبكة/timeout → التالي الآن
 */
export function classifyProviderError(err: unknown): ErrorClass {
  const status = err instanceof ProviderError ? err.status : (err as { status?: number })?.status ?? 0;
  const msg = err instanceof Error ? err.message : String(err ?? "");

  // نفاد الرصيد أولًا — بعض المزودين يرسلونه بحالة 400
  if (RE_EXHAUSTED.test(msg) || status === 402) return "exhausted";
  if (RE_DISABLED.test(msg) || status === 401 || status === 403) return "disabled";
  if (RE_PROVIDER_MODEL.test(msg) && [400, 404, 422].includes(status)) return "provider";
  if (status === 400 || status === 422) return "params";
  if (status === 429 || status >= 500 || status === 408) return "temporary";
  // أخطاء شبكة بلا حالة (fetch throw) → مؤقتة
  if (!status) return "temporary";
  return "temporary";
}

/** هل رسالة فشل منتصف المهمة تطابق نمط مشكلات مفتاح/رصيد؟ (قسم 4.3.2) */
export function looksLikeKeyIssue(msg: string): boolean {
  return /(insufficient|balance|credit|quota|402|401|unauthorized|forbidden|invalid api key)/i.test(msg || "");
}

/** إخفاء المفتاح: أول 7 أحرف + •••••••• + آخر 4 (للقصير: أول 3 + ••••) — إخفاء إلزامي دائم */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return key.slice(0, 3) + "••••";
  return key.slice(0, 7) + "••••••••" + key.slice(-4);
}
