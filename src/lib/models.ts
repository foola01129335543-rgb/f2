// =============================================================================
// سجل الموديلات — الأسماء القياسية والبدائل والمزودون الذين يخدمون كل موديل
// الأسماء قابلة للتجاوز بمتغيرات البيئة (KIE_IMAGE_MODEL ... إلخ)
// ترتيب تجربة المزوّدين = ترتيب قائمة providers لكل موديل أدناه (APInex أولًا للصور)،
// وداخل المزوّد الواحد يُحفظ التسلسلي القديم الصارم حسب إضافة المفاتيح في القاعدة
// =============================================================================

export type ProviderId = "apinex" | "kie" | "cometapi" | "google" | "openrouter" | "pollinations";
export type TaskProvider = ProviderId | "merger";
export type MediaType = "image" | "video" | "merge";

export interface ModelDef {
  canonical: string;          // الاسم كما يراه عميل MCP
  aliases: string[];          // صيغ بديلة نقبلها ونوحّدها (شرطات/نقاط)
  type: MediaType;
  providers: ProviderId[];    // من يستطيع خدمته — تُجرَّب مفاتيحهم كلها بالترتيب
  providerModel: Partial<Record<ProviderId, string>>; // اسم الموديل كما يُرسَل لكل مزود (المزودون غير الخادمين بلا قيمة)
}

const KIE_IMAGE_MODEL = process.env.KIE_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
const COMETAPI_IMAGE_MODEL = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.6-flare-text-to-image";
const COMETAPI_VIDEO_MODEL = process.env.COMETAPI_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
// مزود Google (Gemini API) — للصور فقط؛ مفاتيحه بصيغة AQ. الجديدة من Google AI Studio
// ملاحظة: مفاتيح Google المجانية لا تشمل نماذج الفيديو (Veo)
const GOOGLE_IMAGE_MODEL = process.env.GOOGLE_IMAGE_MODEL || "gemini-2.5-flash-image";
// مزود OpenRouter — صور وفيديو عبر واجهتي /api/v1/images و /api/v1/videos
// الصور: نفس عائلة موديل النظام (gpt-image-2.6 flare) — الفيديو: أرخص نموذج grok imagine lite
// ملاحظة: النماذج المدفوعة تتطلب رصيدًا في حساب OpenRouter (النفاد يعيد 402)
const OPENROUTER_IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "openai/gpt-image-2.6-flare";
const OPENROUTER_VIDEO_MODEL = process.env.OPENROUTER_VIDEO_MODEL || "x-ai/grok-imagine-video-1.5-lite";
// مزود APInex (apinex.bond) — المزود الأول للصور بدلًا من kie.ai بناءً على طلب المالك
// نموذج الصور لديه نفس عائلة النظام القديم (gpt-image-2.6-flare) عبر /v1/images/generations
// ملاحظة: APInex لا يوفّر فيديو إطلاقًا (فحص فعلي: مسار /v1/videos غير موجود)،
// والنماذج المجانية لديه نصوص فقط — توليد الصور يتطلب رصيدًا في الحساب (402 عند النفاد)
const APINEX_IMAGE_MODEL = process.env.APINEX_IMAGE_MODEL || "gpt-image-2.6-flare";
// مزود Pollinations — صور مجانية بدون أي مفتاح (مرجع أخير دائم)
const POLLINATIONS_IMAGE_MODEL = "flux"; // لا اسم موديل يُرسل — ثابت للتوثيق فقط

function withAliases(canonical: string, dottedVariant: string): string[] {
  // نقبل الصيغة البديلة بالنقاط (gpt-image-2.6/... أو grok-imagine-video-1.5-preview) ونوحّدها
  return [dottedVariant];
}

export const MODELS: ModelDef[] = [
  {
    canonical: KIE_IMAGE_MODEL,
    aliases: withAliases(KIE_IMAGE_MODEL, KIE_IMAGE_MODEL.replace(/(\d)-(\d)/g, "$1.$2")),
    type: "image",
    providers: ["apinex", "kie", "cometapi", "google", "openrouter", "pollinations"],
    providerModel: {
      apinex: APINEX_IMAGE_MODEL,
      kie: KIE_IMAGE_MODEL,
      cometapi: COMETAPI_IMAGE_MODEL,
      google: GOOGLE_IMAGE_MODEL,
      openrouter: OPENROUTER_IMAGE_MODEL,
      pollinations: POLLINATIONS_IMAGE_MODEL,
    },
  },
  {
    canonical: KIE_VIDEO_MODEL,
    aliases: withAliases(KIE_VIDEO_MODEL, KIE_VIDEO_MODEL.replace(/(\d)-(\d)/g, "$1.$2")),
    type: "video",
    providers: ["kie", "cometapi", "openrouter"],
    providerModel: {
      kie: KIE_VIDEO_MODEL,
      cometapi: COMETAPI_VIDEO_MODEL,
      openrouter: OPENROUTER_VIDEO_MODEL,
    },
  },
];

export { GOOGLE_IMAGE_MODEL, OPENROUTER_IMAGE_MODEL, OPENROUTER_VIDEO_MODEL, APINEX_IMAGE_MODEL };

/** توحيد اسم الموديل: يقبل الصيغ البديلة ويعيد التعريف القياسي، أو null إن كان مجهولًا */
export function resolveModel(name: string | undefined | null): ModelDef | null {
  if (!name) return MODELS[0]; // الافتراضي للموديل الصوري
  const norm = (s: string) => s.trim().toLowerCase();
  for (const m of MODELS) {
    if (norm(m.canonical) === norm(name)) return m;
    if (m.aliases.some((a) => norm(a) === norm(name))) return m;
  }
  return null;
}

export function modelByCanonical(canonical: string): ModelDef | null {
  return MODELS.find((m) => m.canonical === canonical) ?? null;
}
