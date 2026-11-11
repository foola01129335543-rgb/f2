// =============================================================================
// فهرس المزودين — الوصول الموحّد للمهايئات
// =============================================================================
import type { ProviderId } from "@/lib/models";
import { kieAdapter } from "./kie";
import { cometApiAdapter } from "./cometapi";
import type { ProviderAdapter } from "./types";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  kie: kieAdapter,
  cometapi: cometApiAdapter,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`مزود غير معروف: ${provider}`);
  return a;
}

export * from "./types";
