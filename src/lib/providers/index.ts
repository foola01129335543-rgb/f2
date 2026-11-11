// =============================================================================
// فهرس المزودين — الوصول الموحّد للمهايئات
// =============================================================================
import type { ProviderId } from "@/lib/models";
import { kieAdapter } from "./kie";
import { cometApiAdapter } from "./cometapi";
import { googleAdapter } from "./google";
import type { ProviderAdapter } from "./types";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  kie: kieAdapter,
  cometapi: cometApiAdapter,
  google: googleAdapter,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`مزود غير معروف: ${provider}`);
  return a;
}

export * from "./types";
