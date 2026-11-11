// =============================================================================
// GET /api/tasks — أحدث المهام + الإحصائيات (للوحة المهام الحية)
// =============================================================================
import { NextRequest, NextResponse } from "next/server";
import { listRecentTasks, taskStats, safeParse, type TaskRow } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 20), 1), 50);
    const type = (sp.get("type") ?? undefined) as TaskRow["type"] | undefined;
    const status = (sp.get("status") ?? undefined) as TaskRow["status"] | undefined;

    const [tasks, stats] = await Promise.all([listRecentTasks(limit, { type, status }), taskStats()]);

    return NextResponse.json({
      stats,
      tasks: tasks.map((t) => ({
        id: t.id,
        type: t.type,
        model: t.model,
        status: t.status,
        progress: t.progress,
        prompt: t.prompt,
        urls: safeParse<string[]>(t.result_urls_json, []),
        error: t.error_message,
        attempts: safeParse<{ ok: boolean; errorClass?: string }[]>(t.attempts_json, []).length,
        createdAt: t.created_at,
        completedAt: t.completed_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: `خطأ في جلب المهام: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
