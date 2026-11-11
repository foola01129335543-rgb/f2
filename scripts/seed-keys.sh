#!/usr/bin/env bash
# زرع المفاتيح عبر API: مفتاح خاطئ أولًا ثم الصحيح (اختبار التبديل التسلسلي)
# المفتاح الحقيقي يُقرأ من .env.local ولا يُطبع أبدًا
set -e
BASE="${1:-http://localhost:3000}"
REAL_KEY=$(grep '^KIE_API_KEY=' "$(dirname "$0")/../.env.local" | cut -d= -f2)
if [ -z "$REAL_KEY" ]; then
  echo "REAL_KIE_KEY missing"; exit 1
fi

echo "--- إضافة مفتاح خاطئ (يُجرَّب أولًا حسب ترتيب الإضافة)"
curl -s -X POST "$BASE/api/keys" -H 'Content-Type: application/json' \
  -d '{"provider":"kie","api_key":"kie_invalid_test_key_000000000000000000","label":"اختبار مفتاح خاطئ — يُحذف"}' | head -c 300
echo
sleep 1.5
echo "--- إضافة المفتاح الحقيقي"
curl -s -X POST "$BASE/api/keys" -H 'Content-Type: application/json' \
  -d "{\"provider\":\"kie\",\"api_key\":\"$REAL_KEY\",\"label\":\"kie.ai رئيسي\"}" | head -c 300
echo
echo "--- قائمة المفاتيح بعد الزرع"
curl -s "$BASE/api/keys" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);j.keys.forEach(k=>console.log(k.provider,k.maskedKey,k.status,'\"'+k.label+'\"'))})"
