import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
