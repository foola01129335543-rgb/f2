// =============================================================================
// صياغة الردود العربية لأدوات MCP (القسم 8 في المواصفة)
// القاعدة الذهبية: لا يُذكر أبدًا أمام العميل أي خطأ مفتاح أو رصيد — التبديل صامت.
// =============================================================================

export function fmtImageDone(urls: string[]): string {
  const u = urls[0] ?? "";
  return `✅ تم توليد الصورة بنجاح\n\n![image](${u})\n\nالرابط المباشر: ${u}`;
}

export function fmtVideoDone(urls: string[]): string {
  return `✅ تم توليد الفيديو بنجاح\n\n${urls.map((u) => `الرابط المباشر: ${u}`).join("\n")}`;
}

export function fmtMergeDone(urls: string[]): string {
  return `✅ تم دمج المقاطع بنجاح\n\n${urls.map((u) => `الرابط المباشر: ${u}`).join("\n")}\n\n⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — شاهده/نزّله سريعًا.`;
}

export function fmtProcessing(taskId: string, progress?: number): string {
  const p = typeof progress === "number" && progress > 0 ? ` (التقدم ~${Math.round(progress)}%)` : "";
  return `⏳ المهمة قيد المعالجة — task_id: ${taskId}${p}\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.`;
}

export function fmtFailed(reason: string): string {
  return `❌ فشلت المهمة: ${reason}`;
}

export function fmtNoKeys(model: string): string {
  return `❌ لا توجد مفاتيح نشطة لخدمة ${model}. أضف مفتاحًا واحدًا على الأقل من واجهة الإدارة، ثم أعد المحاولة.`;
}

export function fmtMergeNeedsTwo(detail?: string): string {
  return `❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.${detail ? `\n\n${detail}` : ""}`;
}

export function fmtMergeMax(max: number): string {
  return `❌ أقصى عدد مقاطع للدمج هو ${max} (خدمة الدمج تقبل ${max} مقاطع كحد أقصى).`;
}

export function fmtUnknownTool(name: string, available: string[]): string {
  return `❌ أداة غير معروفة: ${name}. المتاح: ${available.join(", ")}`;
}

export function fmtTaskNotFound(taskId: string): string {
  return `❌ لا توجد مهمة بالمعرّف: ${taskId}. تحقق من task_id أو استخدم list_media لعرض المهام المخزنة.`;
}

/** عرض مهمة مخزنة عبر list_media */
export function fmtMediaList(items: Array<{
  id: string; type: string; status: string; model: string; prompt: string;
  urls: string[]; createdAt: string; error?: string | null; attempts: number;
}>): string {
  if (!items.length) return "لا توجد وسائط مخزنة بعد. استخدم generate_image أو generate_video للتوليد أولًا.";
  const lines = items.map((t, i) => {
    const head = `${i + 1}) [${t.type}] ${t.status} — ${t.model}`;
    const meta = `   المعرف: ${t.id} | أُنشئت: ${t.createdAt} | المحاولات: ${t.attempts}`;
    const prompt = t.prompt ? `   الوصف: ${t.prompt.slice(0, 120)}${t.prompt.length > 120 ? "…" : ""}` : "";
    const urls = t.urls.length ? t.urls.map((u) => `   الرابط: ${u}`).join("\n") : "";
    const err = t.error && t.status === "failed" ? `   السبب: ${t.error}` : "";
    return [head, meta, prompt, urls, err].filter(Boolean).join("\n");
  });
  return `أحدث الوسائط المخزنة (${items.length}):\n\n${lines.join("\n\n")}`;
}

/** عرض مهمة عبر get_task حسب حالتها ونوعها */
export function fmtGetTask(t: {
  id: string;
  type: string;
  status: string;
  progress: number;
  urls: string[];
  error?: string | null;
}): string {
  if (t.status === "completed") {
    if (t.type === "image") return fmtImageDone(t.urls);
    if (t.type === "merge") return fmtMergeDone(t.urls);
    return fmtVideoDone(t.urls);
  }
  if (t.status === "failed") return fmtFailed(t.error ?? "سبب غير معروف");
  return fmtProcessing(t.id, t.progress);
}
