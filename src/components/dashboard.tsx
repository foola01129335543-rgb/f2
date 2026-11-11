// =============================================================================
// لوحة الإدارة العربية — صفحة واحدة بثلاث بطاقات:
// أ) مدير المفاتيح  ب) لوحة المهام الحية  ج) ربط السيرفر
// =============================================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Copy, Trash2, Power, RefreshCw, ExternalLink, KeyRound, Activity, Plug, Plus, CheckCircle2, XCircle, Clock,
} from "lucide-react";

// --- أنواع البيانات -----------------------------------------------------------
interface KeyItem {
  id: string; provider: string; label: string; maskedKey: string;
  status: "active" | "exhausted" | "disabled";
  usageCount: number; successCount: number; failCount: number;
  lastUsedAt: string | null; lastError: string | null; createdAt: string;
}
interface TaskItem {
  id: string; type: "image" | "video" | "merge"; model: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number; prompt: string; urls: string[];
  error: string | null; attempts: number; createdAt: string;
}
interface Stats { total: number; completed: number; failed: number; processing: number }
interface Health {
  ok: boolean; database: string; mcpEndpoint: string;
  merger: { base: string; healthy: boolean };
  authRequired: boolean;
  models: { canonical: string; type: string; providers: string[] }[];
}

const TOOL_CHIPS = [
  { name: "generate_image", desc: "توليد صورة من وصف نصي — قد تعيد الرابط فورًا أو task_id" },
  { name: "generate_video", desc: "توليد فيديو بصوت متزامن أصلي — يعيد task_id ويُتابع بـ get_task" },
  { name: "merge_videos", desc: "دمج مقاطع بالترتيب عبر urls أو task_ids — الناتج يُحذف بعد 24 ساعة" },
  { name: "get_task", desc: "تتبع أي مهمة بمعرّفها كل ~10 ثوانٍ حتى الاكتمال" },
  { name: "list_media", desc: "أحدث الوسائط المخزنة بروابطها لاسترجاع نتائج سابقة" },
];

function copyText(t: { toast: (o: { description?: string }) => void }, text: string, msg = "تم النسخ إلى الحافظة") {
  navigator.clipboard.writeText(text).then(
    () => t.toast({ description: msg }),
    () => t.toast({ description: "تعذر النسخ — انسخ يدويًا" })
  );
}

function statusBadge(s: string) {
  if (s === "active" || s === "completed") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30" variant="outline">نشط</Badge>;
  if (s === "exhausted") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30" variant="outline">مستنزف</Badge>;
  if (s === "disabled") return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30" variant="outline">معطّل</Badge>;
  if (s === "failed") return <Badge className="bg-red-500/15 text-red-400 border-red-500/30" variant="outline">فاشلة</Badge>;
  return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/30" variant="outline">جارية</Badge>;
}

export default function Dashboard() {
  const { toast } = useToast();
  const [health, setHealth] = useState<Health | null>(null);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, completed: 0, failed: 0, processing: 0 });
  // رابط MCP يُحدَّد بعد التحميل لتفادي اختلاف الترطيب بين الخادم والمتصفح
  const [mcpUrl, setMcpUrl] = useState("");

  // نموذج إضافة مفتاح
  const [provider, setProvider] = useState("kie");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      setHealth(await r.json());
    } catch { setHealth(null); }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const r = await fetch("/api/keys", { cache: "no-store" });
      const j = await r.json();
      setKeys(j.keys ?? []);
    } catch { /* تجاهل */ }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks?limit=20", { cache: "no-store" });
      const j = await r.json();
      setTasks(j.tasks ?? []);
      if (j.stats) setStats(j.stats);
    } catch { /* تجاهل */ }
  }, []);

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/mcp`);
    loadHealth();
    loadKeys();
    loadTasks();
    const t1 = setInterval(loadTasks, 5000);   // لوحة المهام تتحدث تلقائيًا كل ~5 ثوانٍ
    const t2 = setInterval(loadHealth, 20000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadTasks, loadHealth, loadKeys]);

  async function addKey() {
    if (!apiKey.trim()) { toast({ description: "أدخل المفتاح أولًا" }); return; }
    setAdding(true);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey.trim(), label: label.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { toast({ description: j.error ?? "فشل الإضافة" }); return; }
      toast({ description: "أُضيف المفتاح — التجربة تسلسلية حسب ترتيب الإضافة" });
      setApiKey(""); setLabel("");
      loadKeys();
    } finally { setAdding(false); }
  }

  async function toggleKey(k: KeyItem) {
    await fetch(`/api/keys/${k.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: k.status === "disabled" ? "enable" : "disable" }),
    });
    loadKeys();
  }

  async function deleteKey(k: KeyItem) {
    await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
    toast({ description: "حُذف المفتاح" });
    loadKeys();
  }

  const authHeaders = health?.authRequired ? `\n      "headers": { "Authorization": "Bearer <MCP_ACCESS_TOKEN>" }` : "";

  const chatgptJson = `{\n  "mcpServers": {\n    "media-generator": {\n      "url": "${mcpUrl}"${authHeaders}\n    }\n  }\n}`;
  const claudeJson = `{\n  "mcpServers": {\n    "media-generator": {\n      "type": "http",\n      "url": "${mcpUrl}"${authHeaders}\n    }\n  }\n}`;
  const cursorJson = `{\n  "mcpServers": {\n    "media-generator": {\n      "url": "${mcpUrl}"${authHeaders}\n    }\n  }\n}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">

        {/* ===== الهيدر — حالة /api/health ===== */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MCP Media Generator</h1>
            <p className="text-sm text-zinc-400">خادم MCP لتوليد الصور والفيديو ودمج المقاطع — لوحة الإدارة</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {health ? (
              <>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${health.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
                  {health.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {health.ok ? "Turso متصل" : "غير متصل"}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${health.merger?.healthy ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>
                  <Activity className="h-4 w-4" />
                  خدمة الدمج {health.merger?.healthy ? "جاهزة" : "غير متاحة"}
                </span>
                {health.authRequired && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-violet-400">
                    <Plug className="h-4 w-4" /> حماية Bearer مفعلة
                  </span>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-400">
                <XCircle className="h-4 w-4" /> غير متصل
              </span>
            )}
            <Button variant="outline" size="icon" onClick={() => { loadHealth(); loadKeys(); loadTasks(); }} aria-label="تحديث">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* ===== أ) مدير المفاتيح ===== */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-cyan-400" /> مدير المفاتيح</CardTitle>
            <CardDescription className="text-zinc-400">
              أضف عدة مفاتيح لكل مزود — التجربة تسلسلية (أول مفتاح ثم التالي ثم التالي) مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد دون توقف.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_1fr_auto]">
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger aria-label="المزود"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kie">kie.ai</SelectItem>
                  <SelectItem value="cometapi">CometAPI</SelectItem>
                  <SelectItem value="google">Google (Gemini)</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="تسمية اختيارية (مثال: مفتاح رئيسي)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <Input placeholder="الصق مفتاح API هنا" value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" />
              <Button onClick={addKey} disabled={adding} className="gap-1.5">
                <Plus className="h-4 w-4" /> إضافة
              </Button>
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg p-1" style={{ scrollbarWidth: "thin" }}>
              {keys.length === 0 && (
                <p className="py-6 text-center text-sm text-zinc-500">لا توجد مفاتيح بعد — أضف مفتاحًا واحدًا على الأقل لبدء التوليد.</p>
              )}
              {keys.map((k, i) => (
                <div key={k.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <span className="font-mono text-xs text-zinc-500">#{i + 1}</span>
                  <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-300">{k.provider === "kie" ? "kie.ai" : k.provider === "google" ? "Google (Gemini)" : "CometAPI"}</Badge>
                  <code className="font-mono text-sm text-zinc-300" dir="ltr">{k.maskedKey}</code>
                  {statusBadge(k.status)}
                  {k.label && <span className="text-sm text-zinc-400">{k.label}</span>}
                  <span className="ms-auto text-xs text-zinc-500">
                    استخدام {k.usageCount} • نجاح {k.successCount} • فشل {k.failCount}
                  </span>
                  {k.lastError && <span className="w-full truncate text-xs text-red-400/80" title={k.lastError}>آخر خطأ: {k.lastError}</span>}
                  <div className="ms-auto flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => toggleKey(k)} aria-label={k.status === "disabled" ? "تنشيط" : "تعطيل"}>
                      <Power className={`h-4 w-4 ${k.status === "disabled" ? "text-emerald-400" : "text-amber-400"}`} />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteKey(k)} aria-label="حذف">
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ===== ب) لوحة المهام ===== */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-emerald-400" /> لوحة المهام</CardTitle>
            <CardDescription className="text-zinc-400">تتحدث تلقائيًا كل ~5 ثوانٍ — المهام الجارية تُحدَّث حية من المزود.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "الإجمالي", v: stats.total, cls: "text-zinc-100" },
                { label: "مكتملة", v: stats.completed, cls: "text-emerald-400" },
                { label: "جارية", v: stats.processing, cls: "text-cyan-400" },
                { label: "فاشلة", v: stats.failed, cls: "text-red-400" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
                  <div className={`text-2xl font-bold ${s.cls}`}>{s.v}</div>
                  <div className="text-xs text-zinc-500">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-lg p-1" style={{ scrollbarWidth: "thin" }}>
              {tasks.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">لا توجد مهام بعد.</p>}
              {tasks.map((t) => (
                <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                      {t.type === "image" ? "صورة" : t.type === "video" ? "فيديو" : "دمج"}
                    </Badge>
                    {statusBadge(t.status)}
                    <code className="font-mono text-xs text-zinc-500" dir="ltr">{t.model}</code>
                    <span className="ms-auto text-xs text-zinc-500" suppressHydrationWarning>{new Date(t.createdAt.replace(" ", "T") + "Z").toLocaleString("ar", { hour12: false })}</span>
                  </div>
                  {t.prompt && <p className="mt-1.5 line-clamp-2 text-sm text-zinc-300">{t.prompt}</p>}
                  {(t.status === "processing" || t.status === "pending") && (
                    <div className="mt-2 flex items-center gap-2">
                      <Progress value={t.progress} className="h-1.5" />
                      <span className="text-xs text-cyan-400">{t.progress}%</span>
                      <Clock className="h-3.5 w-3.5 text-zinc-600" />
                    </div>
                  )}
                  {t.error && t.status === "failed" && <p className="mt-1.5 text-sm text-red-400">❌ {t.error}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>المحاولات: {t.attempts}</span>
                    <code className="font-mono" dir="ltr">{t.id.slice(0, 8)}…</code>
                    {t.urls.length > 0 && t.urls.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:underline">
                        فتح الرابط <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ===== ج) ربط السيرفر ===== */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plug className="h-5 w-5 text-violet-400" /> ربط السيرفر</CardTitle>
            <CardDescription className="text-zinc-400">انسخ الرابط أو إعداد JSON المناسب لعميلك.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={mcpUrl} dir="ltr" className="font-mono text-sm" aria-label="رابط MCP" />
              <Button variant="outline" size="icon" onClick={() => copyText({ toast }, mcpUrl, "نُسخ رابط MCP")} aria-label="نسخ الرابط">
                <Copy className="h-4 w-4" />
              </Button>
            </div>

            <Tabs defaultValue="chatgpt">
              <TabsList className="grid w-full grid-cols-3 bg-zinc-900">
                <TabsTrigger value="chatgpt">ChatGPT / GPT Agents</TabsTrigger>
                <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
                <TabsTrigger value="cursor">Cursor / Windsurf / Cline</TabsTrigger>
              </TabsList>
              <TabsContent value="chatgpt" className="space-y-2">
                <pre dir="ltr" className="max-h-56 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left font-mono text-xs text-zinc-300" style={{ scrollbarWidth: "thin" }}>{chatgptJson}</pre>
                <p className="text-xs text-zinc-400">في ChatGPT: Settings → Connectors → Create → Custom MCP server وضع الرابط في «Server URL».</p>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => copyText({ toast }, chatgptJson, "نُسخ إعداد ChatGPT")}>
                  <Copy className="h-3.5 w-3.5" /> نسخ JSON
                </Button>
              </TabsContent>
              <TabsContent value="claude" className="space-y-2">
                <pre dir="ltr" className="max-h-56 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left font-mono text-xs text-zinc-300" style={{ scrollbarWidth: "thin" }}>{claudeJson}</pre>
                <p className="text-xs text-zinc-400">ضع المحتوى في ملف claude_desktop_config.json ثم أعد تشغيل التطبيق.</p>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => copyText({ toast }, claudeJson, "نُسخ إعداد Claude")}>
                  <Copy className="h-3.5 w-3.5" /> نسخ JSON
                </Button>
              </TabsContent>
              <TabsContent value="cursor" className="space-y-2">
                <pre dir="ltr" className="max-h-56 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left font-mono text-xs text-zinc-300" style={{ scrollbarWidth: "thin" }}>{cursorJson}</pre>
                <p className="text-xs text-zinc-400">ضع المحتوى في mcp.json (Cursor: Settings → MCP → Add new global MCP server).</p>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => copyText({ toast }, cursorJson, "نُسخ إعداد Cursor")}>
                  <Copy className="h-3.5 w-3.5" /> نسخ JSON
                </Button>
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap gap-2">
              {TOOL_CHIPS.map((t) => (
                <span key={t.name} className="inline-flex max-w-full items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
                  <code dir="ltr" className="font-mono text-cyan-300">{t.name}</code>
                  <span className="text-zinc-400">{t.desc}</span>
                </span>
              ))}
            </div>

            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-300">
              الفيديو يحتاج دقائق: يعيد السيرفر task_id فورًا، ويتابع تلقائيًا بـ get_task كل 10 ثوانٍ — وعند اكتمال المهمة يُعرض الرابط في الدردشة ويتوقف. أثناء الانتظار يُبَث تقدم حي (Progress notifications) حتى لا تنقطع العملية.
            </p>
          </CardContent>
        </Card>

        <footer className="pb-4 text-center text-xs text-zinc-600">
          media-generator-mcp v1.2.0 — روابط فقط، بلا تنزيل وسائط على السيرفر • تبديل مفاتيح تسلسلي صامت
        </footer>
      </main>
    </div>
  );
}
