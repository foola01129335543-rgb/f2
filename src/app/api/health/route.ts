// =============================================================================
// GET /api/health — حالة النظام: قاعدة البيانات + نقطة MCP + الموديلات + الدمج
// =============================================================================
import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/turso";
import { MODELS } from "@/lib/models";
import { MERGER_BASE, mergerHealthy } from "@/lib/merger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dbOk = await dbHealthy();
  const mergerOk = await mergerHealthy();

  return NextResponse.json(
    {
      ok: dbOk,
      database: dbOk ? "turso-connected" : "unavailable",
      mcpEndpoint: "/mcp",
      models: MODELS.map((m) => ({
        canonical: m.canonical,
        type: m.type,
        providers: m.providers,
      })),
      merger: { base: MERGER_BASE, healthy: mergerOk },
      authRequired: Boolean(process.env.MCP_ACCESS_TOKEN),
    },
    { status: 200 }
  );
}
