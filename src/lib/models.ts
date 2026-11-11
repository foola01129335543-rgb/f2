// =============================================================================
// سجل الموديلات — الأسماء القياسية والبدائل والمزودون الذين يخدمون كل موديل
// الأسماء قابلة للتجاوز بمتغيرات البيئة (KIE_IMAGE_MODEL ... إلخ)
// =============================================================================

export type ProviderId = "kie" | "cometapi";
export type TaskProvider = ProviderId | "merger";
export type MediaType = "image" | "video" | "merge";

export interface ModelDef {
  canonical: string;          // الاسم كما يراه عميل MCP
  aliases: string[];          // صيغ بديلة نقبلها ونوحّدها (شرطات/نقاط)
  type: MediaType;
  providers: ProviderId[];    // من يستطيع خدمته — تُجرَّب مفاتيحهم كلها بالترتيب
  providerModel: Record<ProviderId, string>; // اسم الموديل كما يُرسَل لكل مزود
}

const KIE_IMAGE_MODEL = process.env.KIE_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
const COMETAPI_IMAGE_MODEL = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.6-flare-text-to-image";
const COMETAPI_VIDEO_MODEL = process.env.COMETAPI_VIDEO_MODEL || "grok-imagine-video-1-5-preview";

function withAliases(canonical: string, dottedVariant: string): string[] {
  // نقبل الصيغة البديلة بالنقاط (gpt-image-2.6/... أو grok-imagine-video-1.5-preview) ونوحّدها
  return [dottedVariant];
}

export const MODELS: ModelDef[] = [
  {
    canonical: KIE_IMAGE_MODEL,
    aliases: withAliases(KIE_IMAGE_MODEL, KIE_IMAGE_MODEL.replace(/(\d)-(\d)/g, "$1.$2")),
    type: "image",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_IMAGE_MODEL, cometapi: COMETAPI_IMAGE_MODEL },
  },
  {
    canonical: KIE_VIDEO_MODEL,
    aliases: withAliases(KIE_VIDEO_MODEL, KIE_VIDEO_MODEL.replace(/(\d)-(\d)/g, "$1.$2")),
    type: "video",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_VIDEO_MODEL, cometapi: COMETAPI_VIDEO_MODEL },
  },
];

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
