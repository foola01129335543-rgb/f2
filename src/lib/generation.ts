// =============================================================================
// منسّق التوليد — runGeneration / runMerge / refreshTask / refreshMergeTask
//
// القواعد الذهبية المطبقة هنا:
// 1) سجل المهمة في Turso قبل أي نداء خارجي.
// 2) تجربة المفاتيح بالترتيب التسلسلي الصارم حسب الإضافة؛ أول نجاح يربط المهمة.
// 3) أي فشل مفتاح/رصيد (قبل الإنشاء أو في منتصف المهمة) → إعادة إنشاء نفس المهمة
//    بنفس task_id على المفتاح التالي تلقائيًا — العميل لا يرى شيئًا أبدًا.
// 4) فشل الإنشاء على كل المفاتيح → تبقى المهمة processing «بانتظار توفر مفتاح
//    صالح…» وتُعاد المحاولة مع كل get_task بعد تهدئة ~45 ثانية.
// 5) الدمج: أي خطأ معلن من خدمة الدمج (4xx/5xx) = فشل حتمي فوري — لا إعادة محاولة.
// =============================================================================
import { randomUUID } from "node:crypto";
import {
  getTask, getKeyPool, insertTask, updateTask,
  setKeyStatus, bumpKeyCounters,
  safeParse, type KeyRow, type TaskRow, type AttemptRecord,
} from "@/lib/turso";
import { resolveModel, type ModelDef } from "@/lib/models";
import { classifyProviderError, looksLikeKeyIssue } from "@/lib/keys";
import { getAdapter, ProviderError, type ImageInput, type VideoInput } from "@/lib/providers";
import {
  MERGER_LIMITS, createMergeJob, getMergeJob, processMergeJob, type MergerJobInfo,
} from "@/lib/merger";
import {
  fmtFailed, fmtGetTask, fmtImageDone, fmtMergeDone, fmtMergeMax, fmtMergeNeedsTwo,
  fmtNoKeys, fmtProcessing, fmtTaskNotFound, fmtVideoDone,
} from "@/lib/format";

// سقف نافذة الانتظار داخل الطلب (قابل للضبط) — بعده يعيد الأداة task_id ليتابع العميل بـ get_task
const WAIT_CAP = Math.min(Math.max(Number(process.env.MCP_WAIT_CAP_SECONDS ?? 240), 0), 240);
const POLL_INTERVAL_MS = 3_000;
const CREATE_RETRY_COOLDOWN_MS = 45_000;

export interface ToolOutcome {
  status: "completed" | "processing" | "failed" | "no_keys" | "params";
  text: string;
  isError?: boolean;
  task?: TaskRow;
}

type NotifyFn = (progress: number, total: number, message: string) => Promise<void>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** إخفاء أي نص طويل قد يحتوي مفاتيح من رسائل الأخطاء قبل عرضها للعميل */
function sanitize(msg: string): string {
  return String(msg ?? "سبب غير معروف").replace(/[A-Za-z0-9_\-./]{25,}/g, "***").slice(0, 300);
}

function effectiveWait(requested: number | undefined, fallback: number): number {
  const w = typeof requested === "number" && requested >= 0 ? requested : fallback;
  return Math.min(w, WAIT_CAP);
}

// -----------------------------------------------------------------------------
// بناء معطيات المزود من معطيات الأداة
// -----------------------------------------------------------------------------
function buildImageInput(args: Record<string, unknown>): ImageInput {
  const input: ImageInput = { prompt: String(args.prompt) };
  const ar = args.aspect_ratio as string | undefined;
  if (ar && ar !== "auto") input.aspect_ratio = ar;
  if (args.resolution) input.resolution = String(args.resolution);
  if (args.output_format) input.output_format = String(args.output_format);
  // background يُطبق عند 1K فقط حسب المواصفة
  if (args.background && args.background !== "auto" && (args.resolution ?? "1K") === "1K") {
    input.background = String(args.background);
  }
  return input;
}

function buildVideoInput(args: Record<string, unknown>): VideoInput {
  const input: VideoInput = { prompt: String(args.prompt) };
  if (args.image_url) input.image_url = String(args.image_url);
  const ar = args.aspect_ratio as string | undefined;
  if (ar && ar !== "auto") input.aspect_ratio = ar;
  if (args.resolution) input.resolution = String(args.resolution);
  if (typeof args.enable_audio === "boolean") input.enable_audio = args.enable_audio;
  if (typeof args.duration === "number") input.duration = Math.round(args.duration);
  return input;
}

interface CreateAttemptOutcome {
  kind: "created" | "created_sync" | "params" | "exhausted";
  key?: KeyRow;
  providerTaskId?: string;
  syncUrls?: string[];
  paramsMessage?: string;
}

/**
 * تجربة المرشحين بالترتيب حتى نجاح الإنشاء.
 * كل محاولة (نجاحًا أو فشلًا) تُسجَّل في attempts_json وتحدّث عدّادات المفتاح.
 * skipIds: مفاتيح يُتجاوزها هذا التشغيل فقط (المفتاح الذي فشل للتو في منتصف المهمة).
 */
async function tryCreateWithKeys(opts: {
  task: TaskRow;
  modelDef: ModelDef;
  input: ImageInput | VideoInput;
  skipIds?: Set<string>;
}): Promise<CreateAttemptOutcome> {
  const { task, modelDef, input, skipIds } = opts;
  const pool = await getKeyPool(modelDef.providers);
  const candidates = pool.filter((k) => !skipIds?.has(k.id));

  for (const key of candidates) {
    const adapter = getAdapter(key.provider);
    const providerModel = modelDef.providerModel[key.provider] ?? modelDef.canonical;
    try {
      // صور متزامنة إن دعم المزود ذلك (CometAPI)
      if (task.type === "image" && adapter.createImageSync) {
        const { urls } = await adapter.createImageSync(key, input as ImageInput);
        await bumpKeyCounters(key.id, true);
        // مفتاح كان مستنزفًا وعاد للعمل (شُحن رصيده) → نعيده active
        if (key.status === "exhausted") await setKeyStatus(key.id, "active", null);
        await recordAttempt(task.id, { provider: key.provider, keyId: key.id, ok: true });
        return { kind: "created_sync", key, syncUrls: urls };
      }
      const { providerTaskId } = await adapter.createTask(key, providerModel, input);
      await bumpKeyCounters(key.id, true);
      if (key.status === "exhausted") await setKeyStatus(key.id, "active", null);
      await recordAttempt(task.id, { provider: key.provider, keyId: key.id, ok: true });
      return { kind: "created", key, providerTaskId };
    } catch (err) {
      const cls = classifyProviderError(err);
      const msg = err instanceof Error ? err.message : String(err);
      await bumpKeyCounters(key.id, false, msg.slice(0, 240));
      await recordAttempt(task.id, {
        provider: key.provider, keyId: key.id, ok: false,
        errorClass: cls, error: msg.slice(0, 240),
      });
      if (cls === "params") {
        // خطأ معطيات — توقف فورًا: تبديل المفاتيح لن يحلّه
        return { kind: "params", paramsMessage: sanitize(msg) };
      }
      if (cls === "disabled") {
        await setKeyStatus(key.id, "disabled", msg.slice(0, 240)); // مفتاح مرفوض → تعطيل تلقائي
        continue; // → المفتاح التالي
      }
      if (cls === "exhausted") {
        await setKeyStatus(key.id, "exhausted", msg.slice(0, 240)); // يبقى في القاعدة
        continue; // → المفتاح التالي
      }
      // provider (موديل غير مدعوم) أو temporary → التالي
      continue;
    }
  }
  return { kind: "exhausted" };
}

async function recordAttempt(taskId: string, a: Omit<AttemptRecord, "at">): Promise<void> {
  // تُسجَّل المحاولة عبر updateTask بلا تعديل حقول أخرى
  await updateTask(taskId, {}, { ...a, at: new Date().toISOString() });
}

// -----------------------------------------------------------------------------
// توليد صورة / فيديو
// -----------------------------------------------------------------------------
export async function runGeneration(
  type: "image" | "video",
  args: Record<string, unknown>,
  notify?: NotifyFn
): Promise<ToolOutcome> {
  const modelDef = resolveModel(args.model as string | undefined);
  if (!modelDef || modelDef.type !== type) {
    return {
      status: "params",
      isError: true,
      text: fmtFailed(`موديل غير معروف: ${String(args.model ?? "")}. المتاح: gpt-image-2-6/flare-text-to-image (صور) و grok-imagine-video-1-5-preview (فيديو).`),
    };
  }

  const pool = await getKeyPool(modelDef.providers);
  if (!pool.length) return { status: "no_keys", isError: true, text: fmtNoKeys(modelDef.canonical) };

  // 3) سجّل المهمة قبل أي نداء خارجي
  const input = type === "image" ? buildImageInput(args) : buildVideoInput(args);
  let task = await insertTask({
    id: randomUUID(),
    model: modelDef.canonical,
    type,
    prompt: input.prompt,
    params_json: JSON.stringify(args),
    status: "processing",
  });

  const waitSec = effectiveWait(args.wait_seconds as number | undefined, type === "image" ? 90 : 25);
  let deadline = Date.now() + waitSec * 1000;

  // 4) تجربة المرشحين بالترتيب حتى نجاح الإنشاء
  let created = await tryCreateWithKeys({ task, modelDef, input });
  if (created.kind === "params") {
    task = (await updateTask(task.id, { status: "failed", error_message: created.paramsMessage }))!;
    return { status: "failed", isError: true, text: fmtFailed(created.paramsMessage!), task };
  }
  if (created.kind === "exhausted") {
    // تبقى processing — تُعاد المحاولة مع كل get_task بعد التهدئة (لا شيء يُذكر للعميل)
    task = (await updateTask(task.id, { error_message: "بانتظار توفر مفتاح صالح…" }))!;
    return { status: "processing", text: fmtProcessing(task.id), task };
  }

  if (created.kind === "created_sync") {
    task = (await updateTask(task.id, {
      provider: created.key!.provider, key_id: created.key!.id,
      status: "completed", result_urls_json: JSON.stringify(created.syncUrls),
    }))!;
    notify?.(100, 100, "اكتمل التوليد").catch(() => {});
    return { status: "completed", text: fmtImageDone(created.syncUrls!), task };
  }

  // نجح الإنشاء — اربط المهمة بالمزود والمفتاح
  task = (await updateTask(task.id, {
    provider: created.key!.provider,
    provider_task_id: created.providerTaskId,
    key_id: created.key!.id,
    progress: 5,
  }))!;
  let providerTaskId = created.providerTaskId!;
  let adapter = getAdapter(created.key!.provider);
  let currentKey = created.key!;

  // 5) نافذة الانتظار: استعلام كل 3 ثوانٍ مع بث تقدم حي
  while (Date.now() < deadline) {
    let check;
    try {
      check = await adapter.checkTask(currentKey, providerTaskId);
    } catch (err) {
      // أخطاء شبكتنا نحن (timeout/fetch) = مؤقتة → استمر بالاستعلام
      if (!(err instanceof ProviderError) || err.status !== 0) {
        // خطأ مصنَّف من المزود أثناء الاستعلام: عالجه كفشل منتصف مهمة
        check = { status: "failed", error: err instanceof Error ? err.message : String(err) };
      } else {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
    }

    if (check.status === "processing") {
      const p = check.progress ?? task.progress;
      if (Number.isFinite(p) && p > task.progress) task = (await updateTask(task.id, { progress: Math.round(p) })) ?? task;
      notify?.(Math.round(check.progress ?? task.progress), 100, `قيد التوليد… ${Math.round(check.progress ?? task.progress)}%`).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (check.status === "completed" && check.urls?.length) {
      task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(check.urls) }))!;
      notify?.(100, 100, "اكتمل التوليد").catch(() => {});
      return {
        status: "completed",
        text: type === "image" ? fmtImageDone(check.urls) : fmtVideoDone(check.urls),
        task,
      };
    }

    if (check.status === "failed") {
      const msg = String(check.error ?? "");
      if (looksLikeKeyIssue(msg)) {
        // فشل مفتاح/رصيد في منتصف المهمة → أعد إنشاء نفس المهمة بنفس task_id على المفتاح التالي
        const skip = new Set<string>([currentKey.id]);
        const retry = await tryCreateWithKeys({ task, modelDef, input, skipIds: skip });
        if (retry.kind === "created" || retry.kind === "created_sync") {
          task = (await updateTask(task.id, {
            provider: retry.key!.provider,
            key_id: retry.key!.id,
            provider_task_id: retry.providerTaskId ?? task.provider_task_id,
            error_message: null,
            progress: 5,
          }))!;
          if (retry.kind === "created_sync") {
            task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(retry.syncUrls) }))!;
            return { status: "completed", text: fmtImageDone(retry.syncUrls!), task };
          }
          providerTaskId = retry.providerTaskId!;
          adapter = getAdapter(retry.key!.provider);
          currentKey = retry.key!;
          deadline = Date.now() + waitSec * 1000; // نافذة جديدة للمحاولة الجديدة
          continue;
        }
        if (retry.kind === "params") {
          task = (await updateTask(task.id, { status: "failed", error_message: retry.paramsMessage }))!;
          return { status: "failed", isError: true, text: fmtFailed(retry.paramsMessage!), task };
        }
        // لا مفتاح متاح الآن → تبقى processing بصمت
        task = (await updateTask(task.id, { error_message: "بانتظار توفر مفتاح صالح…" }))!;
        return { status: "processing", text: fmtProcessing(task.id), task };
      }
      // فشل حقيقي (انتهاك سياسة/معطيات) → failed
      task = (await updateTask(task.id, { status: "failed", error_message: sanitize(msg) }))!;
      return { status: "failed", isError: true, text: fmtFailed(sanitize(msg)), task };
    }
  }

  // 7) انتهت النافذة والنتيجة لم تظهر → أعد المهمة بحالة processing ليتابعها العميل
  return { status: "processing", text: fmtProcessing(task.id, task.progress), task };
}

// -----------------------------------------------------------------------------
// دمج الفيديوهات — runMerge (القسم 7.3)
// -----------------------------------------------------------------------------
export async function runMerge(args: Record<string, unknown>, notify?: NotifyFn): Promise<ToolOutcome> {
  const urlsArg = Array.isArray(args.urls) ? (args.urls as string[]) : [];
  const taskIdsArg = Array.isArray(args.task_ids) ? (args.task_ids as string[]) : [];

  // 1) تحقق صارم: مجموع ≥2 و ≤10
  if (urlsArg.length + taskIdsArg.length < 2) {
    return { status: "params", isError: true, text: fmtMergeNeedsTwo() };
  }
  if (urlsArg.length + taskIdsArg.length > MERGER_LIMITS.maxClips) {
    return { status: "params", isError: true, text: fmtMergeMax(MERGER_LIMITS.maxClips) };
  }

  // 2) حل روابط task_ids أولًا (مهام فيديو مكتملة بالترتيب) ثم urls المباشرة
  const videos: string[] = [];
  const failedDetails: string[] = [];
  for (const tid of taskIdsArg) {
    const t = await getTask(String(tid));
    if (!t || t.type !== "video") failedDetails.push(`• ${tid}: مهمة غير موجودة أو ليست مهمة فيديو`);
    else if (t.status !== "completed") failedDetails.push(`• ${tid}: المهمة ليست مكتملة بعد (حالتها ${t.status})`);
    else {
      const urls = safeParse<string[]>(t.result_urls_json, []);
      if (!urls.length) failedDetails.push(`• ${tid}: مهمة مكتملة بلا روابط`);
      else videos.push(urls[0]);
    }
  }
  videos.push(...urlsArg.map(String));

  if (videos.length < 2) {
    return { status: "params", isError: true, text: fmtMergeNeedsTwo(failedDetails.join("\n")) };
  }
  // كل الروابط http/https مباشرة وعامة
  const bad = videos.find((u) => !/^https?:\/\//i.test(u));
  if (bad) return { status: "params", isError: true, text: fmtFailed(`الرابط غير صالح للدمج (يجب أن يكون http/https مباشرًا وعامًا): ${bad.slice(0, 120)}`) };

  // 3) سجّل المهمة أولًا
  let task = await insertTask({
    id: randomUUID(),
    provider: "merger",
    model: "video-merger",
    type: "merge",
    prompt: `دمج ${videos.length} مقاطع`,
    params_json: JSON.stringify(args),
    status: "processing",
  });

  // 4) أنشئ مهمة الدمج لدى الخدمة — أي خطأ معلن = فشل حتمي فوري
  let jobId: string;
  try {
    const createdJob = await createMergeJob(videos);
    jobId = createdJob.jobId;
  } catch (err) {
    const msg = sanitize(err instanceof Error ? err.message : String(err));
    task = (await updateTask(task.id, { status: "failed", error_message: msg }))!;
    return { status: "failed", isError: true, text: fmtFailed(msg), task };
  }
  task = (await updateTask(task.id, { provider_task_id: jobId }))!;

  // 5) أطلق process — يُنفَّذ مرة واحدة فقط (القفل داخل عميل الدمج)
  const processPromise = processMergeJob(jobId).catch(() => null);

  const waitSec = effectiveWait(args.wait_seconds as number | undefined, 60);
  const deadline = Date.now() + waitSec * 1000;

  // 6) استعلم كل 3 ثوانٍ مع بث تقدم — تحديث الحالة يُكتب في Turso فورًا
  while (Date.now() < deadline) {
    let info: MergerJobInfo;
    try {
      info = await getMergeJob(jobId);
    } catch (err) {
      if (err instanceof ProviderError && (err as ProviderError & { mergerNotFound?: boolean }).mergerNotFound) {
        task = (await updateTask(task.id, { status: "failed", error_message: err.message }))!;
        return { status: "failed", isError: true, text: fmtFailed(err.message), task };
      }
      await sleep(POLL_INTERVAL_MS); // شبكتنا نحن → مؤقت
      continue;
    }

    if (info.status === "done" && (info.videoUrl || info.downloadUrl)) {
      const urls = [info.videoUrl ?? info.downloadUrl!];
      task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(urls) }))!;
      notify?.(100, 100, "اكتمل الدمج").catch(() => {});
      void processPromise; // اكتملنا قبل انتهاء انتظار process — لا شيء مطلوب
      return { status: "completed", text: fmtMergeDone(urls), task };
    }
    if (info.status === "failed") {
      // خطأ معلن من الخدمة = فشل نهائي فوري — لا إعادة محاولة (قاعدة حتمية)
      task = (await updateTask(task.id, { status: "failed", error_message: sanitize(info.error ?? "فشل الدمج") }))!;
      void processPromise;
      return { status: "failed", isError: true, text: fmtFailed(sanitize(info.error ?? "فشل الدمج")), task };
    }

    task = (await updateTask(task.id, { status: "processing", progress: info.progress }))!;
    notify?.(info.progress, 100, `جارٍ الدمج… ${info.progress}%`).catch(() => {});
    await sleep(POLL_INTERVAL_MS);
  }

  void processPromise;
  return { status: "processing", text: fmtProcessing(task.id, task.progress), task };
}

// -----------------------------------------------------------------------------
// تتبع مهمة — refreshTask (get_task) مع نفس منطق التبديل أعلاه
// -----------------------------------------------------------------------------
export async function refreshTask(taskId: string): Promise<ToolOutcome> {
  let task = await getTask(taskId);
  if (!task) return { status: "failed", isError: true, text: fmtTaskNotFound(taskId) };

  if (task.status === "completed") {
    const urls = safeParse<string[]>(task.result_urls_json, []);
    return { status: "completed", text: fmtGetTask({ ...task, urls }), task };
  }
  if (task.status === "failed") {
    return { status: "failed", isError: true, text: fmtGetTask({ ...task, urls: [] }), task };
  }

  // جارية — حدّثها حية
  if (task.type === "merge") return refreshMergeTask(task);

  const modelDef = resolveModel(task.model);
  if (!modelDef) {
    task = (await updateTask(task.id, { status: "failed", error_message: "موديل المهمة غير معروف" }))!;
    return { status: "failed", isError: true, text: fmtFailed(task.error_message!), task };
  }

  if (!task.provider || !task.provider_task_id) {
    // لم يُنشأ بعد على أي مزود (فشل على كل المفاتيح) — أعد المحاولة بعد تهدئة 45 ثانية
    const since = Date.now() - new Date(task.updated_at.replace(" ", "T") + "Z").getTime();
    if (since < CREATE_RETRY_COOLDOWN_MS) {
      return { status: "processing", text: fmtProcessing(task.id, task.progress), task };
    }
    const input = task.type === "image" ? buildImageInput(safeParse(task.params_json, {})) : buildVideoInput(safeParse(task.params_json, {}));
    const created = await tryCreateWithKeys({ task, modelDef, input });
    if (created.kind === "created" || created.kind === "created_sync") {
      task = (await updateTask(task.id, {
        provider: created.key!.provider, key_id: created.key!.id,
        provider_task_id: created.providerTaskId ?? null,
        error_message: null, progress: 5,
      }))!;
      if (created.kind === "created_sync") {
        task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(created.syncUrls) }))!;
        return { status: "completed", text: fmtImageDone(created.syncUrls!), task };
      }
      return { status: "processing", text: fmtProcessing(task.id, 5), task };
    }
    if (created.kind === "params") {
      task = (await updateTask(task.id, { status: "failed", error_message: created.paramsMessage }))!;
      return { status: "failed", isError: true, text: fmtFailed(created.paramsMessage!), task };
    }
    // ما زلنا بلا مفاتيح صالحة — اضبط التهدئة من جديد (لا شيء يُذكر للعميل)
    task = (await updateTask(task.id, { error_message: "بانتظار توفر مفتاح صالح…" }))!;
    return { status: "processing", text: fmtProcessing(task.id), task };
  }

  // مهمة جارية لدى مزود — استعلم حالتها
  const adapter = getAdapter(task.provider as "kie" | "cometapi");
  let keyRow = await findKeyById(task.key_id);
  if (!keyRow && task.provider_task_id) {
    // المفتاح حُذف أو غير مسجّل لكن المهمة قائمة لدى المزود — استعلام فقط بأي مفتاح متاح
    const pool = await getKeyPool([task.provider as "kie" | "cometapi"]);
    if (pool.length) keyRow = pool[0];
  }
  if (!keyRow) {
    // لا مفتاح للاستعلام ولا مهمة قائمة — أعد الإنشاء على أي مفتاح متاح
    const input = task.type === "image" ? buildImageInput(safeParse(task.params_json, {})) : buildVideoInput(safeParse(task.params_json, {}));
    const created = await tryCreateWithKeys({ task, modelDef, input });
    if (created.kind === "created" || created.kind === "created_sync") {
      task = (await updateTask(task.id, {
        provider: created.key!.provider, key_id: created.key!.id,
        provider_task_id: created.providerTaskId ?? null, progress: 5, error_message: null,
      }))!;
      if (created.kind === "created_sync") {
        task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(created.syncUrls) }))!;
        return { status: "completed", text: fmtImageDone(created.syncUrls!), task };
      }
      return { status: "processing", text: fmtProcessing(task.id, 5), task };
    }
    return { status: "processing", text: fmtProcessing(task.id, task.progress), task };
  }

  let check;
  try {
    check = await adapter.checkTask(keyRow, task.provider_task_id!);
  } catch (err) {
    if (err instanceof ProviderError && err.status === 0) {
      return { status: "processing", text: fmtProcessing(task.id, task.progress), task }; // شبكة → مؤقت
    }
    check = { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  if (check.status === "processing") {
    const p = check.progress ?? task.progress;
    if (Number.isFinite(p) && p > task.progress) task = (await updateTask(task.id, { progress: Math.round(p) })) ?? task;
    return { status: "processing", text: fmtProcessing(task.id, task.progress), task };
  }

  if (check.status === "completed" && check.urls?.length) {
    task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(check.urls) }))!;
    return { status: "completed", text: fmtGetTask({ ...task, urls: check.urls }), task };
  }

  // فشل منتصف مهمة — نفس منطق التبديل
  const msg = String(check.error ?? "");
  if (looksLikeKeyIssue(msg)) {
    const input = task.type === "image" ? buildImageInput(safeParse(task.params_json, {})) : buildVideoInput(safeParse(task.params_json, {}));
    const created = await tryCreateWithKeys({ task, modelDef, input, skipIds: new Set([keyRow.id]) });
    if (created.kind === "created" || created.kind === "created_sync") {
      task = (await updateTask(task.id, {
        provider: created.key!.provider, key_id: created.key!.id,
        provider_task_id: created.providerTaskId ?? null, progress: 5, error_message: null,
      }))!;
      if (created.kind === "created_sync") {
        task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(created.syncUrls) }))!;
        return { status: "completed", text: fmtImageDone(created.syncUrls!), task };
      }
      return { status: "processing", text: fmtProcessing(task.id, 5), task };
    }
    if (created.kind === "params") {
      task = (await updateTask(task.id, { status: "failed", error_message: created.paramsMessage }))!;
      return { status: "failed", isError: true, text: fmtFailed(created.paramsMessage!), task };
    }
    task = (await updateTask(task.id, { error_message: "بانتظار توفر مفتاح صالح…" }))!;
    return { status: "processing", text: fmtProcessing(task.id), task };
  }

  task = (await updateTask(task.id, { status: "failed", error_message: sanitize(msg) }))!;
  return { status: "failed", isError: true, text: fmtFailed(sanitize(msg)), task };
}

async function findKeyById(id: string | null): Promise<KeyRow | null> {
  if (!id) return null;
  const { getKey } = await import("@/lib/turso");
  return getKey(id);
}

// -----------------------------------------------------------------------------
// تتبع مهمة دمج — refreshMergeTask (القسم 7.3.6)
// -----------------------------------------------------------------------------
async function refreshMergeTask(task: TaskRow): Promise<ToolOutcome> {
  if (!task.provider_task_id) {
    // فشل إنشاء مهمة الدمج سابقًا — أعد المحاولة بعد التهدئة
    const since = Date.now() - new Date(task.updated_at.replace(" ", "T") + "Z").getTime();
    if (since < CREATE_RETRY_COOLDOWN_MS) {
      return { status: "processing", text: fmtProcessing(task.id, task.progress), task };
    }
    const params = safeParse<Record<string, unknown>>(task.params_json, {});
    const vids = Array.isArray(params.urls) ? (params.urls as string[]).map(String) : [];
    if (vids.length < 2) {
      task = (await updateTask(task.id, { status: "failed", error_message: "روابط الدمج الأصلية غير متوفرة" }))!;
      return { status: "failed", isError: true, text: fmtFailed(task.error_message!), task };
    }
    try {
      const createdJob = await createMergeJob(vids);
      task = (await updateTask(task.id, { provider_task_id: createdJob.jobId, error_message: null }))!;
      void processMergeJob(createdJob.jobId).catch(() => null);
      return { status: "processing", text: fmtProcessing(task.id, task.progress), task };
    } catch (err) {
      const msg = sanitize(err instanceof Error ? err.message : String(err));
      task = (await updateTask(task.id, { status: "failed", error_message: msg }))!;
      return { status: "failed", isError: true, text: fmtFailed(msg), task };
    }
  }

  let info: MergerJobInfo;
  try {
    info = await getMergeJob(task.provider_task_id);
  } catch (err) {
    if (err instanceof ProviderError && (err as ProviderError & { mergerNotFound?: boolean }).mergerNotFound) {
      // 404 → فشل نهائي: حُذفت أو انتهت صلاحيتها بعد 24 ساعة
      task = (await updateTask(task.id, { status: "failed", error_message: err.message }))!;
      return { status: "failed", isError: true, text: fmtFailed(err.message), task };
    }
    return { status: "processing", text: fmtProcessing(task.id, task.progress), task }; // شبكتنا → مؤقت
  }

  if (info.status === "done" && (info.videoUrl || info.downloadUrl)) {
    const urls = [info.videoUrl ?? info.downloadUrl!];
    task = (await updateTask(task.id, { status: "completed", result_urls_json: JSON.stringify(urls) }))!;
    return { status: "completed", text: fmtMergeDone(urls), task };
  }
  if (info.status === "failed") {
    task = (await updateTask(task.id, { status: "failed", error_message: sanitize(info.error ?? "فشل الدمج") }))!;
    return { status: "failed", isError: true, text: fmtFailed(sanitize(info.error ?? "فشل الدمج")), task };
  }
  if (info.status === "queued") {
    // أُنشئت المهمة ولم يُنفَّذ process بعد → نفّذه الآن (القفل يمنع التزامن)
    void processMergeJob(task.provider_task_id).catch(() => null);
  }
  task = (await updateTask(task.id, { status: "processing", progress: info.progress }))!;
  return { status: "processing", text: fmtProcessing(task.id, info.progress), task };
}

// -----------------------------------------------------------------------------
// list_media — استرجاع الوسائط المخزنة بروابطها (بدون إعادة توليد)
// -----------------------------------------------------------------------------
export async function listMedia(args: Record<string, unknown>): Promise<ToolOutcome> {
  const { listRecentTasks } = await import("@/lib/turso");
  const { fmtMediaList } = await import("@/lib/format");
  const type = args.type as TaskRow["type"] | undefined;
  const status = args.status as TaskRow["status"] | undefined;
  const limit = typeof args.limit === "number" ? args.limit : 10;

  const tasks = await listRecentTasks(limit, { type, status });
  const items = tasks.map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    model: t.model,
    prompt: t.prompt,
    urls: safeParse<string[]>(t.result_urls_json, []),
    createdAt: t.created_at,
    error: t.error_message,
    attempts: safeParse<AttemptRecord[]>(t.attempts_json, []).length,
  }));
  return { status: "completed", text: fmtMediaList(items) };
}
