// يضيف المكتبات المستوردة في src لكن الناقصة من dependencies في package.json
// بنفس الإصدارات المثبتة محليًا (^x.y.z) — ثم يحفظ الملف منسّقًا
import { readFileSync, writeFileSync } from "node:fs";

const missing = {
  "@radix-ui/react-accordion": "1.2.12",
  "@radix-ui/react-alert-dialog": "1.1.15",
  "@radix-ui/react-aspect-ratio": "1.1.8",
  "@radix-ui/react-checkbox": "1.3.3",
  "@radix-ui/react-collapsible": "1.1.12",
  "@radix-ui/react-context-menu": "2.2.16",
  "@radix-ui/react-dialog": "1.1.15",
  "@radix-ui/react-dropdown-menu": "2.1.16",
  "@radix-ui/react-hover-card": "1.1.15",
  "@radix-ui/react-label": "2.1.8",
  "@radix-ui/react-menubar": "1.1.16",
  "@radix-ui/react-navigation-menu": "1.2.14",
  "@radix-ui/react-popover": "1.1.15",
  "@radix-ui/react-radio-group": "1.3.8",
  "@radix-ui/react-scroll-area": "1.2.10",
  "@radix-ui/react-separator": "1.1.8",
  "@radix-ui/react-slider": "1.3.6",
  "@radix-ui/react-switch": "1.2.6",
  "@radix-ui/react-toggle": "1.1.10",
  "@radix-ui/react-toggle-group": "1.1.11",
  "@radix-ui/react-tooltip": "1.2.8",
  "cmdk": "1.1.1",
  "embla-carousel-react": "8.6.0",
  "input-otp": "1.4.2",
  "next-themes": "0.4.6",
  "react-day-picker": "9.13.0",
  "react-hook-form": "7.71.1",
  "react-resizable-panels": "3.0.6",
  "recharts": "2.15.4",
  "sonner": "2.0.7",
  "vaul": "1.1.2",
};

const path = "./package.json";
const pkg = JSON.parse(readFileSync(path, "utf8"));
const before = Object.keys(pkg.dependencies).length;

for (const [name, version] of Object.entries(missing)) {
  if (pkg.dependencies[name]) {
    console.log(`موجودة مسبقًا، تخطي: ${name}`);
    continue;
  }
  pkg.dependencies[name] = `^${version}`;
}

// ترتيب أبجدي للتبعيات
pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
console.log(`تم: ${before} → ${Object.keys(pkg.dependencies).length} مكتبة في dependencies`);
