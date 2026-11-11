// =============================================================================
// PATCH  /api/keys/{id} — تعطيل/تنشيط يدوي {action: "disable" | "enable"}
// DELETE /api/keys/{id} — حذف المفتاح
// =============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getKey, setKeyStatus, deleteKey } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const action = body?.action;

    if (action !== "disable" && action !== "enable") {
      return NextResponse.json({ error: 'الإجراء يجب أن يكون "disable" أو "enable"' }, { status: 400 });
    }
    const key = await getKey(id);
    if (!key) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });

    await setKeyStatus(id, action === "disable" ? "disabled" : "active", action === "enable" ? null : undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: `خطأ في تحديث المفتاح: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const ok = await deleteKey(id);
    if (!ok) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: `خطأ في حذف المفتاح: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
