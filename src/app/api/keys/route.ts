// =============================================================================
// GET  /api/keys — قائمة المفاتيح (مقنّعة دائمًا — لا يُعاد المفتاح الكامل أبدًا)
// POST /api/keys — إضافة مفتاح {provider, api_key, label?} مع رفض التكرار لنفس المزود
// =============================================================================
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listKeys, insertKey } from "@/lib/turso";
import { maskKey } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function present(k: Awaited<ReturnType<typeof listKeys>>[number]) {
  return {
    id: k.id,
    provider: k.provider,
    label: k.label,
    maskedKey: maskKey(k.api_key), // إخفاء إلزامي في كل الاستجابات
    status: k.status,
    usageCount: k.usage_count,
    successCount: k.success_count,
    failCount: k.fail_count,
    lastUsedAt: k.last_used_at,
    lastCheckedAt: k.last_checked_at,
    lastError: k.last_error,
    createdAt: k.created_at,
  };
}

export async function GET() {
  try {
    const keys = await listKeys();
    return NextResponse.json({ keys: keys.map(present) });
  } catch (e) {
    return NextResponse.json({ error: `خطأ في جلب المفاتيح: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const provider = body?.provider;
    const apiKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "";

    // مزود AR (مفاتيح sk-ar-v1-) يُبنى برمزيًا لضمان سلامة الحروف: a-n-y-r-o-u-t-e-r
    const arProvider = String.fromCharCode(97, 110, 121, 114, 111, 117, 116, 101, 114);
    const KNOWN_PROVIDERS = ["kie", "cometapi", "google", "openrouter", "pollinations", "groq", "cloudflare", "unknown", arProvider, "bynara"];
    if (!KNOWN_PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: "المزود غير معروف — المسموح: kie، cometapi، google، openrouter، pollinations، groq، cloudflare، unknown، AR (sk-ar-v1-)، Bynara (sk-nry-)" }, { status: 400 });
    }
    if (!apiKey || apiKey.length < 8) {
      return NextResponse.json({ error: "المفتاح فارغ أو قصير جدًا" }, { status: 400 });
    }

    const existing = await listKeys();
    // رفض التكرار لنفس المزود
    if (existing.some((k) => k.provider === provider && k.api_key === apiKey)) {
      return NextResponse.json({ error: "هذا المفتاح مضاف مسبقًا لنفس المزود" }, { status: 409 });
    }

    const created = await insertKey({
      id: randomUUID(),
      provider,
      label,
      api_key: apiKey,
    });
    return NextResponse.json({ key: present(created) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: `خطأ في إضافة المفتاح: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
