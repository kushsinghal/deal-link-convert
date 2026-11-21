export const CONVERTER_NAMES: Record<string, string> = { extrape: "ExtraPe", earnkaro: "EarnKaro", sankmo: "Sankmo", amazon: "My Amazon.in tag", original: "Keep clean link" };
export const NETWORK_ORDER = ["extrape", "earnkaro", "sankmo"];

/** Shared by the engine and admin preview. Support probes never disable a route. */
export function routeForStore(settings: any, store: string): string[] {
  const chain = settings.affiliate_chains?.[store];
  if (Array.isArray(chain)) return chain.length ? chain : ["original"];
  const order: string[] = [...new Set<string>([...(settings.converter_order || []), ...NETWORK_ORDER])].filter(k => NETWORK_ORDER.includes(k));
  const preferred = store === "Amazon" ? settings.amazon_route : settings.affiliate_routes?.[store];
  if (preferred === "original") return ["original"];
  const result = preferred && preferred !== "default" && (NETWORK_ORDER.includes(preferred) || (store === "Amazon" && preferred === "amazon"))
    ? [preferred, ...order.filter(k => k !== preferred)] : order;
  return store === "Amazon" ? result.filter(k => k !== "sankmo") : result;
}