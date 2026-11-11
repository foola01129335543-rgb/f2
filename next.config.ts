import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ملاحظة نشر: output:"standalone" يمنع Vercel من خدمة المسارات نهائيًا (404 شامل)
  // — أُزيل لبيئة Vercel فقط، ولا يؤثر على سلوك التطبيق أو أدواته أو نماذجه.
  reactStrictMode: false,
  async rewrites() {
    return {
      // مسار /mcp الرسمي يعاد توجيهه إلى Pages API لكي يحصل على كائنات Node
      // الحقيقية (IncomingMessage/ServerResponse) التي يتطلبها StreamableHTTPServerTransport
      // من SDK الرسمي — مع الحفاظ على نفس المسار المتوقع من عملاء MCP.
      beforeFiles: [{ source: "/mcp", destination: "/api/mcp" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
