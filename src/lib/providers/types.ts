// =============================================================================
// أنواع مزودي التوليد — كل مزود يطبّق ProviderAdapter ويرمي ProviderError
// ليُصنَّف في نظام التبديل التسلسلي (src/lib/keys.ts)
// =============================================================================
import type { KeyRow } from "@/lib/turso";

export interface CreateTaskResult {
  providerTaskId: string;
}

export interface CheckResult {
  status: "processing" | "completed" | "failed";
  urls?: string[];
  error?: string;
  progress?: number; // 0..100
}

export interface ImageInput {
  prompt: string;
  aspect_ratio?: string;
  resolution?: string;
  background?: string;
  output_format?: string;
}

export interface VideoInput {
  prompt: string;
  image_url?: string;
  aspect_ratio?: string;
  resolution?: string;
  enable_audio?: boolean;
  duration?: number;
}

export interface ProviderAdapter {
  /** مهمة غير متزامنة (فيديو، وبعض الصور): تعيد providerTaskId */
  createTask(key: KeyRow, model: string, input: ImageInput | VideoInput): Promise<CreateTaskResult>;
  /** صور متزامنة إن كان المزود يدعمها (CometAPI تعيد النتيجة فورًا) */
  createImageSync?(key: KeyRow, input: ImageInput): Promise<{ urls: string[] }>;
  /** استعلام حالة مهمة جارية */
  checkTask(key: KeyRow, providerTaskId: string): Promise<CheckResult>;
}

/** خطأ موحّد من المزود — يُصنَّف لاحقًا في classifyProviderError */
export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}
