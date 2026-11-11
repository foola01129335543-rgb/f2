// =============================================================================
// خادم MCP — المسار /mcp (عبر إعادة توجيه next.config من /mcp إلى /api/mcp)
//
// قرار تقني موثّق: StreamableHTTPServerTransport من SDK الرسمي يتطلب كائنات Node
// الحقيقية (IncomingMessage/ServerResponse) غير المتاحة في App Router route
// handlers، لذا يُنفَّذ الخادم هنا كـ Pages API route (كائنات Node أصلية،
// متوافق مع Vercel) بنفس المسار /mcp المطلوب. لا JSON-RPC يدويًا إطلاقًا —
// كل شيء عبر McpServer + StreamableHTTPServerTransport الرسميين.
//
// وضع Stateless (بلا جلسات): كل طلب مستقل — الإعداد الصحيح لبيئة Vercel
// serverless حيث لا توجد ذاكرة مشتركة بين الطلبات.
// =============================================================================
import type { NextApiRequest, NextApiResponse } from "next";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";
import { runGeneration, runMerge, refreshTask, listMedia, type ToolOutcome } from "@/lib/generation";
import { MODELS } from "@/lib/models";

export const config = {
  api: { bodyParser: false, externalResolver: true },
  maxDuration: 300,
};

export const SERVER_INFO = { name: "media-generator-mcp", version: "1.2.0" } as const;

export const SERVER_INSTRUCTIONS = `AI media generation server (kie.ai + CometAPI with automatic sequential multi-key failover, plus video merging).
Workflow: call generate_image or generate_video. If the response contains finished URLs, show them to the user.
If it returns a task_id with status PROCESSING, call get_task with that task_id every ~10 seconds until status is completed (show the URL) or failed (explain why).
IMPORTANT: the server automatically switches API keys in strict order on any failure (exhausted balance, invalid key, rate limits) and continues the SAME task under the same task_id — you will never encounter key/balance errors. Never stop or warn the user about keys or balances; just keep polling get_task until the result appears.
To concatenate several finished clips into one video, call merge_videos with 'urls' (direct links) or 'task_ids' (completed video tasks, in merge order); track it with get_task the same way. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.
Use list_media to recall previously generated media from the database.`;

// قيم الـ enum الديناميكية من سجل الموديلات (تطابق قيم المواصفة افتراضيًا)
const IMAGE_MODEL_ENUM = [MODELS[0].canonical, ...MODELS[0].aliases] as [string, ...string[]];
const VIDEO_MODEL_ENUM = [MODELS[1].canonical, ...MODELS[1].aliases] as [string, ...string[]];

function outcomeToResult(o: ToolOutcome) {
  return { content: [{ type: "text" as const, text: o.text }], isError: o.isError === true };
}

/** إشعارات التقدم — تُبَث فقط إذا زوّد العميل الطلب بـ _meta.progressToken */
function makeNotify(extra: RequestHandlerExtra<any, any>) {
  const token = extra?._meta?.progressToken;
  if (token === undefined || token === null) return undefined;
  return async (progress: number, total: number, message: string) => {
    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress, total, message },
      } as never);
    } catch { /* العميل قد يكون انقطع — نتجاهل */ }
  };
}

function buildServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  // --- 1) generate_image -----------------------------------------------------
  server.registerTool(
    "generate_image",
    {
      description:
        "توليد صورة بـ gpt-image-2-6/flare-text-to-image (تبديل تلقائي عبر كل المفاتيح النشطة). تعيد رابط الصورة جاهزًا إذا اكتملت خلال نافذة الانتظار، وإلا تعيد task_id — استدعِ get_task كل ~10 ثوانٍ حتى completed ثم اعرض الرابط وتوقف.",
      inputSchema: {
        prompt: z.string().min(1).describe("What to draw. Detailed prompts give better results."),
        model: z.enum(IMAGE_MODEL_ENUM).default(IMAGE_MODEL_ENUM[0]).describe("Image model."),
        aspect_ratio: z.enum(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"]).default("auto").describe("Aspect ratio of the image."),
        resolution: z.enum(["1K", "2K", "4K"]).default("1K").describe("Output resolution tier."),
        background: z.enum(["auto", "transparent", "opaque"]).default("auto").describe("Only applied at 1K."),
        output_format: z.enum(["png", "jpeg", "webp", "gif"]).default("png").describe("Output file format."),
        wait_seconds: z.number().int().min(0).max(240).default(90).describe("How long to wait inline before returning a task_id."),
      },
    },
    async (args, extra) => outcomeToResult(await runGeneration("image", args as Record<string, unknown>, makeNotify(extra)))
  );

  // --- 2) generate_video -----------------------------------------------------
  server.registerTool(
    "generate_video",
    {
      description:
        "توليد فيديو بـ grok-imagine-video-1-5-preview (صوت متزامن أصلي، image-to-video اختياري). الفيديو يحتاج دقائق: انتظار قصير مع بث تقدم ثم task_id — تابع بـ get_task كل ~10 ثوانٍ.",
      inputSchema: {
        prompt: z.string().max(4096).describe("Scene description. Dialogue in the prompt is spoken in the video."),
        image_url: z.string().optional().describe("Optional public image URL as the first frame (image-to-video)."),
        model: z.enum(VIDEO_MODEL_ENUM).default(VIDEO_MODEL_ENUM[0]).describe("Video model."),
        aspect_ratio: z.enum(["auto", "1:1", "16:9", "9:16", "3:2", "2:3"]).default("auto").describe("Aspect ratio of the video."),
        resolution: z.enum(["480p", "720p", "1080p"]).default("480p").describe("Output resolution."),
        enable_audio: z.boolean().default(true).describe("Generate native synchronized audio."),
        duration: z.number().int().min(1).max(15).default(8).describe("Duration in seconds."),
        wait_seconds: z.number().int().min(0).max(240).default(25).describe("How long to wait inline before returning a task_id."),
      },
    },
    async (args, extra) => outcomeToResult(await runGeneration("video", args as Record<string, unknown>, makeNotify(extra)))
  );

  // --- 3) merge_videos -------------------------------------------------------
  server.registerTool(
    "merge_videos",
    {
      description:
        "دمج عدة مقاطع في فيديو واحد نهائي بالترتيب المعطى. مرر urls (روابط فيديو مباشرة عامة — مثل روابط generate_video) أو task_ids (لمهام فيديو مكتملة تُحل روابطها من قاعدة البيانات بالترتيب — مثالي بعد توليد عدة مقاطع). الدمج سريع عادةً: انتظار قصير مع بث تقدم ثم task_id للدمج — تابعه بـ get_task. the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.",
      inputSchema: {
        urls: z.array(z.string()).min(2).max(10).optional().describe("Public direct video URLs (http/https) in merge order — the first clip starts the final video."),
        task_ids: z.array(z.string()).min(2).max(10).optional().describe("Alternative to urls: task_ids of COMPLETED video generation tasks — their result URLs are merged in this order."),
        wait_seconds: z.number().int().min(0).max(240).default(60).describe("How long to wait inline before returning a task_id."),
      },
    },
    async (args, extra) => outcomeToResult(await runMerge(args as Record<string, unknown>, makeNotify(extra)))
  );

  // --- 4) get_task -----------------------------------------------------------
  server.registerTool(
    "get_task",
    {
      description:
        "تتبع أي مهمة بمعرّفها — توليد صور/فيديو ودمج (يقرأ قاعدة البيانات ويحدّث من المزود/خدمة الدمج إن كانت جارية). استعلمه كل ~10 ثوانٍ؛ عند completed ستجد روابط النتائج — اعرضها للمستخدم وتوقف عن الاستعلام.",
      inputSchema: {
        task_id: z.string().describe("The task_id returned by a generation/merge tool."),
      },
    },
    async (args) => outcomeToResult(await refreshTask(String(args.task_id)))
  );

  // --- 5) list_media ---------------------------------------------------------
  server.registerTool(
    "list_media",
    {
      description:
        "أحدث الصور/الفيديوهات/الدمجات المخزنة بروابطها من قاعدة البيانات (بدون إعادة توليد) — لاسترجاع نتائج سابقة.",
      inputSchema: {
        type: z.enum(["image", "video", "merge"]).optional().describe("Filter by media type."),
        status: z.enum(["completed", "failed", "processing"]).optional().describe("Filter by task status."),
        limit: z.number().int().min(1).max(50).default(10).describe("How many recent tasks to return."),
      },
    },
    async (args) => outcomeToResult(await listMedia(args as Record<string, unknown>))
  );

  return server;
}

// -----------------------------------------------------------------------------
// المعالج — POST لرسائل JSON-RPC (عبر النقل الرسمي)، DELETE لإنهاء الجلسة،
// GET غير مدعوم في وضع Stateless.
// -----------------------------------------------------------------------------
async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // حماية اختيارية بـ Bearer token عند ضبط MCP_ACCESS_TOKEN
  const requiredToken = process.env.MCP_ACCESS_TOKEN;
  if (requiredToken) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${requiredToken}`) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: Bearer token required" }, id: null });
      return;
    }
  }

  if (req.method === "DELETE") {
    // إنهاء جلسة — في وضع stateless لا شيء لإنهائه؛ نرد نجاحًا بصمت
    res.status(200).json({});
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method Not Allowed" }, id: null });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(await readRawBody(req));
  } catch {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // وضع stateless — مناسب لبيئة serverless
    enableJsonResponse: false,     // بث SSE حتى تعمل إشعارات التقدم الحية
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: `Internal server error: ${err instanceof Error ? err.message : String(err)}` },
        id: null,
      });
    }
  }
}
