# MCP Media Generator

خادم **MCP (Model Context Protocol)** لتوليد الصور والفيديو بالذكاء الاصطناعي ودمج المقاطع — مع لوحة إدارة عربية RTL بالكامل.

> ✦ **توليد صور** من وصف نصي — `gpt-image-2-6/flare-text-to-image`
> ✦ **توليد فيديو** بصوت متزامن أصلي — `grok-imagine-video-1-5-preview`
> ✦ **دمج عدة مقاطع** في فيديو واحد عالي الجودة — عبر خدمة دمج مرفقة في `merger-service/`

---

## المزايا الجوهرية

- **تبديل مفاتيح تسلسلي صامت:** أول مفتاح أُضيف يُجرَّب أولًا ثم التالي ثم التالي (الترتيب حسب الإضافة تمامًا — ليس round-robin). عند أي خطأ أو نفاد رصيد ينتقل تلقائيًا للمفتاح التالي **بنفس المهمة ونفس `task_id`** دون أن يرى نموذج الذكاء الاصطناعي أو المستخدم أي ذكر للمفاتيح أو الرصيد أبدًا.
- **مهمة لا تموت أبدًا:** إن فشل الإنشاء على كل المفاتيح تبقى المهمة `processing` وتُعاد محاولتها تلقائيًا مع كل استدعاء `get_task` (بتهدئة ~45 ثانية) — بشحن الرصيد تكتمل المهمة من تلقاء نفسها.
- **روابط فقط:** لا يُنزَّل أي ملف وسائط على السيرفر إطلاقًا — تُخزَّن روابط النتائج فقط في قاعدة البيانات.
- **بث تقدم حي:** إشعارات Progress notifications كل ~3 ثوانٍ أثناء نافذة الانتظار.
- **قاعدة Turso (libSQL) عبر HTTP:** متوافقة تمامًا مع بيئة Vercel الـ serverless — بلا ملفات محلية.
- **إخفاء المفاتيح إلزامي:** كل الاستجابات تعرض المفاتيح مقنّعة (`ABCD123••••••••WXYZ`) ولا يُعاد المفتاح الكامل أبدًا.

## الأدوات الخمس على `/mcp`

| الأداة | الوظيفة |
|---|---|
| `generate_image` | توليد صورة — تعيد الرابط إذا اكتملت خلال نافذة الانتظار وإلا `task_id` |
| `generate_video` | توليد فيديو بصوت متزامن — انتظار قصير ثم `task_id` يُتابع بـ `get_task` |
| `merge_videos` | دمج مقاطع بالترتيب عبر `urls` أو `task_ids` — الناتج يُحذف بعد ~24 ساعة |
| `get_task` | تتبع أي مهمة بمعرّفها — يقرأ القاعدة ويحدّث من المزود حيًّا |
| `list_media` | أحدث الوسائط المخزنة بروابطها — لاسترجاع نتائج سابقة |

## الهيكل

```
├── src/app/                 # لوحة الإدارة العربية + مسارات API (health/keys/tasks)
├── src/lib/                 # turso.ts • models.ts • keys.ts • generation.ts • merger.ts • format.ts
├── src/lib/providers/       # مهايئات kie.ai و CometAPI
├── src/pages/api/mcp.ts     # خادم MCP (SDK الرسمي) على /mcp عبر إعادة توجيه
├── merger-service/          # مشروع خدمة دمج الفيديوهات المستقل (ينشر كمشروع Vercel ثانٍ)
└── scripts/                 # سكربتات الاختبار e2e والتنظيف
```

> **ملاحظة تقنية:** نقلة `StreamableHTTPServerTransport` من SDK الرسمي تتطلب كائنات Node الحقيقية (`IncomingMessage/ServerResponse`) غير المتاحة في App Router، لذا يعمل خادم MCP كـ Pages API route مع إعادة توجيه `/mcp → /api/mcp` — نفس المسار المتوقع من عملاء MCP، وبلا أي JSON-RPC يدوي.

## التشغيل المحلي

```bash
bun install
cp .env.example .env.local    # ثم املأ القيم
bun run dev                   # http://localhost:3000
```

- الواجهة: `http://localhost:3000/`
- نقطة MCP: `http://localhost:3000/mcp`
- فحص الجهوزية: `http://localhost:3000/api/health`

### متغيرات البيئة (`.env.local` محليًا، وVercel → Settings → Environment Variables للإنتاج)

| المتغير | إلزامي؟ | الوصف |
|---|---|---|
| `TURSO_DATABASE_URL` | نعم | رابط قاعدة Turso `libsql://…` |
| `TURSO_AUTH_TOKEN` | نعم | توكن Turso بصلاحيات كتابة |
| `MERGER_API_BASE` | نعم للدمج | رابط خدمة الدمج المنشورة (مشروع `merger-service`) |
| `MCP_ACCESS_TOKEN` | لا | عند ضبطه يُطلب `Authorization: Bearer <token>` على `/mcp` |
| `KIE_IMAGE_MODEL` / `KIE_VIDEO_MODEL` | لا | تجاوز اسم موديل kie |
| `COMETAPI_IMAGE_MODEL` / `COMETAPI_VIDEO_MODEL` | لا | تجاوز اسم موديل CometAPI |
| `MCP_WAIT_CAP_SECONDS` | لا | سقف نافذة الانتظار داخل الطلب (افتراضي 240) |

> **`.env*` مستثنى من Git منذ أول commit — لا ترفع أي سر إلى المستودع أبدًا.**

## النشر على Vercel (مشروعان من نفس المستودع)

### المشروع الأول — خادم MCP + اللوحة (جذر المستودع)

1. اربط المستودع على Vercel → **New Project** → Import.
2. Framework: Next.js (يُكتشف تلقائيًا). اترك الإعدادات الافتراضية.
3. أضف متغيرات البيئة: `TURSO_DATABASE_URL` و `TURSO_AUTH_TOKEN` (و`MERGER_API_BASE` بعد نشر خدمة الدمج).
4. Deploy. بعدها أضف مفتاحًا واحدًا على الأقل من واجهة الإدارة (تبويب «مدير المفاتيح») — يُخزَّن في Turso فيصلح لكل النسخ.

> إن فشل النشر برسالة تخص `maxDuration` على خطة قديمة بلا Fluid Compute، خفّض `maxDuration` من 300 إلى 60 في `src/pages/api/mcp.ts` ومسارات `src/app/api` (أو فعّل Fluid Compute من Project Settings → Functions).

### المشروع الثاني — خدمة دمج الفيديوهات

1. **New Project** من نفس المستودع → في **Root Directory** اختر `merger-service`.
2. أضف متغيري Turso نفسهما (`TURSO_DATABASE_URL` و `TURSO_AUTH_TOKEN`) — الجداول مختلفة فلا تعارض.
3. Deploy، ثم خذ رابط الخدمة (مثل `https://merger-xxx.vercel.app`) وضعه في `MERGER_API_BASE` على المشروع الأول.
4. التفاصيل الكاملة في [merger-service/README.md](merger-service/README.md).

## الربط من عملاء MCP

انسخ الإعداد المناسب من بطاقة «ربط السيرفر» في الواجهة مباشرة، أو استخدم:

**ChatGPT (Settings → Connectors → Create → Custom MCP server):**
```json
{"mcpServers":{"media-generator":{"url":"https://YOUR-DOMAIN/mcp"}}}
```

**Claude Desktop (`claude_desktop_config.json`):**
```json
{"mcpServers":{"media-generator":{"type":"http","url":"https://YOUR-DOMAIN/mcp"}}}
```

**Cursor / Windsurf / Cline (`mcp.json`):** نفس صيغة ChatGPT.

إن ضُبط `MCP_ACCESS_TOKEN` أضف `"headers": {"Authorization": "Bearer <token>"}`.

## الاختبارات

```bash
# خادم التطوير يعمل على 3000 وخدمة الدمج على 3001 (cd merger-service && bun run dev)
node scripts/mcp-smoke.sh                 # تهيئة + tools/list
node scripts/e2e-image.mjs                # توليد صورة e2e + فحص عدم تسريب المفاتيح
node scripts/e2e-video.mjs                # توليد فيديو + متابعة get_task كل 10 ثوانٍ
node scripts/poll-task.mjs <BASE> <TASK>  # متابعة مهمة جارية
cd merger-service && bun run test:unit && bun run test:http   # اختبارات خدمة الدمج
node scripts/cleanup.mjs                  # تنظيف آثار الاختبار من القاعدة
```

## ملاحظات إنتاجية

- الفيديو يحتاج دقائق: الأداة تعيد `task_id` فورًا ويتابعه العميل بـ `get_task` كل ~10 ثوانٍ.
- ملفات الدمج تُحذف من خدمة الدمج بعد ~24 ساعة — التنبيه مذكور في وصف الأداة وفي تعليمات السيرفر ليُبلَّغ المستخدم.
- أخطاء خدمة الدمج المعلنة (HTTP 4xx/5xx) فشل حتمي فوري؛ أخطاء الشبكة مؤقتة وتستمر بالاستعلام.
- مصنّف أخطاء المزودين: `disabled` (401/403) → تعطيل تلقائي • `exhausted` (402/رصيد) → يبقى في القاعدة ويعمل بعد الشحن • `params` → توقف فوري • `temporary` (429/5xx/شبكة) → التالي.
