# خدمة دمج الفيديوهات — Video Merger API

موقع كامل لدمج الفيديوهات + واجهة برمجية عامة (API) للمطورين — جاهز للنشر على Vercel.

- **Node.js خالص (CommonJS)** بلا Next.js ولا خطوة بناء: واجهة ثابتة (HTML+CSS+JS ملف واحد) في `public/` + دوال Vercel Serverless في `api/`.
- **Turso (libSQL)** تخزَّن فيها كل شيء: المهام، أجزاء الملفات المصدرية، والفيديو الناتج (Blobs). لا S3 ولا خدمات خارجية.
- **ffmpeg + ffprobe داخل الدالة نفسها** (`ffmpeg-static` + `ffprobe-static`).
- واجهة **عربية RTL بثيم داكن** (تدرجات سماوي/بنفسجي).

## الحدود

| الحد | القيمة | متغير البيئة |
|---|---|---|
| عدد المقاطع | 10 كحد أقصى | `MAX_SOURCES` |
| حجم كل مصدر | 200MB | `SOURCE_MAX_MB` |
| حجم الناتج | 150MB | `OUTPUT_MAX_MB` |
| مجموع المدد | 600 ثانية | `MAX_TOTAL_DURATION_SEC` |
| جودة الناتج | MP4 — H.264 CRF 18 + AAC 192k/44100، حتى 1080p، +faststart | `FFMPEG_PRESET` (الـ preset) |
| الصلاحية | **كل الملفات تُحذف تلقائيًا بعد 24 ساعة** | — |

لا توجد معاملات resolution/fps — الناتج مُوحَّد تلقائيًا: scale+pad إلى أكبر دقة بين المدخلات (حد 1920×1080 أبعاد زوجية)، fps=30، yuv420p، والمصدر بلا صوت يُعطى مسارًا صامتًا `anullsrc` بنفس مدته.

## إنشاء قاعدة Turso والحصول على التوكن

```bash
# ثبّت CLI ثم سجّل الدخول
turso db create f2-merger
turso db show f2-merger --url        # ← هذا هو TURSO_DATABASE_URL
turso db tokens create f2-merger     # ← هذا هو TURSO_AUTH_TOKEN (بصلاحيات كتابة)
```

يمكنك أيضًا استخدام نفس قاعدة المشروع الرئيسي — الجداول مختلفة (`jobs/sources/source_chunks/output_chunks`) فلا تعارض.

## النشر على Vercel خطوة بخطوة

1. ارفع المستودع إلى GitHub (إن لم يكن مرفوعًا).
2. على Vercel: **Add New → Project** → اختر المستودع.
3. في إعدادات المشروع قبل أول Deploy:
   - **Root Directory**: `merger-service` (مهم — حتى يُبنى هذا المجلد فقط).
   - **Environment Variables**: أضف `TURSO_DATABASE_URL` و `TURSO_AUTH_TOKEN` (الاختيارية: `MAX_SOURCES`, `SOURCE_MAX_MB`, `OUTPUT_MAX_MB`, `MAX_TOTAL_DURATION_SEC`, `FFMPEG_PRESET`).
4. Deploy — سيكتشف Vercel دوال `api/` تلقائيًا (بلا Build Command).
5. بعد النشر: `vercel.json` مفعّل مسبقًا بـ `maxDuration: 300` لكل الدوال + **Cron يومي** على `/api/cron` (الساعة 03:00 UTC) لحذف المهام المنتهية.
6. خذ رابط الخدمة وضعه في `MERGER_API_BASE` على مشروع MCP الرئيسي.

## تجربة الـ API بـ curl بعد النشر

```bash
BASE=https://your-merger.vercel.app

# 1) فحص الجهوزية والحدود
curl $BASE/api/config

# 2) إنشاء مهمة دمج من روابط مباشرة
curl -X POST $BASE/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"videos":["https://www.w3schools.com/html/mov_bbb.mp4","https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"]}'
# → 201 {"jobId":"...","status":"queued","statusUrl":"...","processUrl":"...","expiresAt":"..."}

# 3) تنفيذ الدمج (متزامن — يستغرق ~10-15 ثانية)
curl -X POST $BASE/api/jobs/{jobId}/process
# → 200 {"status":"done","videoUrl":"$BASE/api/jobs/{jobId}/video","downloadUrl":"...?download=1","size":...,"duration":...,"resolution":"640x360","expiresAt":"..."}
# ملاحظة: لو رد 202 فالمهمة قيد المعالجة — تابع بـ GET /api/jobs/{jobId}

# 4) الحالة والتقدم (0-100)
curl $BASE/api/jobs/{jobId}

# 5) بث الناتج بدعم Range (يعمل التقديم/الترجيع في المشغل)
curl -H "Range: bytes=0-1023" $BASE/api/jobs/{jobId}/video
# → 206 + Content-Range

# 6) التحميل المباشر
curl -o merged.mp4 "$BASE/api/jobs/{jobId}/video?download=1"

# 7) رفع ملف من الجهاز (أجزاء ثنائية ≤4MB)
curl -X POST "$BASE/api/upload?job={jobId}&seq=1&chunk=0" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @part0.bin

# 8) الحذف الفوري الشامل
curl -X DELETE $BASE/api/jobs/{jobId}
```

الرفع من الواجهة يتم أجزاءً 4MB تلقائيًا (حد حجم الطلب في Vercel ≈ 4.5MB) مع إعادة محاولة ×3 لأي جزء يفشل.

## نقاط النهاية

| Method | Endpoint | الوظيفة |
|---|---|---|
| `POST` | `/api/jobs` | إنشاء مهمة — يقبل `{"videos":[...]}` أو `{"sources":[...]}` |
| `POST` | `/api/upload?job=&seq=&chunk=` | رفع أجزاء الملفات (ثنائي ≤4MB) |
| `POST` | `/api/jobs/{id}/process` | تنفيذ الدمج كاملًا → رابط الفيديو النهائي (202 إن كانت جارية) |
| `GET` | `/api/jobs/{id}` | الحالة + التقدم + الرابط عند الاكتمال |
| `GET` | `/api/jobs/{id}/video` | بث الناتج بدعم Range — `?download=1` للتحميل |
| `DELETE` | `/api/jobs/{id}` | حذف فوري شامل (المهمة + المصادر + كل الأجزاء) |
| `GET` | `/api/config` | الحدود العامة + version |
| `GET` | `/api/cron` | حذف المهام المنتهية (مجدول يوميًا في vercel.json) |

الأخطاء دائمًا بصيغة `{"error":"..."}` برسائل عربية: 400 لمدخلات تالفة، 404 لغير الموجود، 409 لحالة غير مناسبة، 413 لتجاوز الحجم، 405 لطريقة خاطئة. CORS مفتوح وبلا تسجيل دخول.

حالات المهمة: `queued` → (`uploading`) → `processing` → `done` | `failed`.

## التشغيل والاختبار محليًا

```bash
cp .env.example .env       # املأ متغيري Turso
bun install
bun run dev                # خادم تطوير يحاكي Vercel على http://localhost:3001
bun run test:unit          # 18 فحصًا: الدمج والتوحيد والتخزين وsha256 والحدود
bun run test:http          # 28 فحصًا: تدفق كامل + Range + مختلط + أخطاء
```

خادم التطوير (`scripts/dev-server.js`) يحاكي بيئة Vercel: يضبط مساعدات `res.status().json()`، ويحلّل المسارات الديناميكية إلى `req.query`، ويخدم `public/` — نفس ملفات `api/` تعمل على البيئتين حرفيًا.

## حدود الخطة المجانية التي يجب معرفتها

- **مدة الدالة:** Hobby حتى 60 ثانية/دالة بلا Fluid Compute و**حتى 300 ثانية** معه (مفعّل افتراضيًا في المشاريع الجديدة) — ضُبط `maxDuration: 300` ويمكن تخفيضه.
- **حجم الطلب:** ≈ 4.5MB — لذلك الرفع أجزاءً 4MB.
- **حجم قاعدة Turso:** الخطة المجانية حتى 500MB و1 مليار قراءة صف/شهر — فيديو 150MB يشغل جزءًا كبيرًا؛ التنظيف اليومي (Cron) والحذف بعد 24 ساعة يبقيان الاستهلاك تحت السيطرة، والحذف بعد نجاح الدمج لأجزاء المصادر يقلصه أكثر.
- `/tmp` مؤقت فقط أثناء المعالجة ويُنظَّف دائمًا في `finally` — لا اعتماد على نظام ملفات دائم.
