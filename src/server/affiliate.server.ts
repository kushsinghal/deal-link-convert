import * as engine from "./engine.server";

function isOwnAffiliateLink(url: string, settings: any) {
  let p: URL;
  try { p = new URL(url); } catch { return false; }
  const host = p.hostname.toLowerCase();
  const tag = String(settings?.amazon_tag || "").trim();
  return !!tag && ["amazon.in", "www.amazon.in"].includes(host) && p.searchParams.get("tag") === tag && engine.affiliateRoute("Amazon", settings) === "amazon";
}

export type KnownLink = (url: string) => Promise<{ cleaned?: string } | null>;

export async function convertAffiliate(original: string, settings: any, fast = false, known?: KnownLink) {
  if (isOwnAffiliateLink(original, settings)) {
    return { original, cleaned: original, converted: original, changed: false, error: null as string | null, store: engine.detectStore(original), own: true };
  }
  // A link this bot made earlier is already yours: it is kept, not converted a second time.
  const prior = known ? await known(original).catch(() => null) : null;
  if (prior?.cleaned) return { original, cleaned: prior.cleaned, converted: original, changed: false, error: null as string | null, store: engine.detectStore(prior.cleaned), own: true };
  const cleaned = await engine.cleanLink(original, fast);
  const used: { service?: string } = {};
  try {
    const converted = await engine.convertLink(cleaned, settings, used);
    const keepClean = settings.convert_enabled === false || engine.affiliateRoute(engine.detectStore(cleaned), settings) === "original";
    return { original, cleaned, converted, changed: converted !== cleaned, keep_clean: keepClean, error: null as string | null, store: engine.detectStore(cleaned), service: used.service };
  } catch (error) {
    const store = engine.detectStore(cleaned);
    // Links to sites that are not shops (news, social, blogs) are simply left as they are.
    if (store === "Other") return { original, cleaned, converted: original, changed: false, error: null as string | null, store, unsupported: true };
    return { original, cleaned, converted: cleaned, changed: false, error: String(error instanceof Error ? error.message : error).slice(0, 300), store };
  }
}

type Entity = { type: string; offset: number; length: number; url?: string | undefined; [key: string]: unknown };
type Span = { start: number; end: number; url: string; raw: string };
type Replacement = { start: number; end: number; newStart: number; newEnd: number };

const linkLabel = (store: string) => `@${(store && store !== "Other" ? store : "Link").replace(/\s+/g, "")}`;

/** Telegram offsets and JavaScript slices both use UTF-16 code units. */
export async function convertAffiliateText(text: string, settings: any, entities: Entity[] = [], known?: KnownLink) {
  const spans: Span[] = [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => {
    const url = m[0].replace(/[.,;!]+$/, "");
    return { start: m.index!, end: m.index! + url.length, url, raw: url };
  });
  // Links typed without http (amzn.to/abc, www.flipkart.com/...) arrive from Telegram as "url" entities.
  for (const e of entities) {
    if (e.type !== "url" || spans.some((s) => e.offset < s.end && e.offset + e.length > s.start)) continue;
    const raw = text.slice(e.offset, e.offset + e.length);
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) spans.push({ start: e.offset, end: e.offset + e.length, url: `https://${raw}`, raw });
  }
  spans.sort((a, b) => a.start - b.start);
  const linkEntities = entities.filter((e) => e.type === "text_link" && e.url);
  const urls = [...new Set([...spans.map((s) => s.url), ...linkEntities.map((e) => e.url!)])];
  if (urls.length > 10) throw new Error("Send up to 10 links in one message");
  const items = await Promise.all(urls.map((url) => {
    const host = new URL(url).hostname;
    if (/^(?:[^.]+\.)?(?:x\.com|twitter\.com|t\.me|telegram\.me|facebook\.com|instagram\.com|youtube\.com|youtu\.be|wa\.me|whatsapp\.com)$/.test(host))
      return Promise.resolve({ original: url, cleaned: url, converted: url, changed: false, error: null, store: "Other", unsupported: true });
    return convertAffiliate(url, settings, true, known);
  }));
  const byUrl = new Map(items.map((i) => [i.original, i]));

  let message = "";
  let cursor = 0;
  const replacements: Replacement[] = [];
  const labelEntities: Entity[] = [];
  const dropped = (item: any) => !!item.error || (!item.changed && !item.own && !item.keep_clean);
  for (const span of spans) {
    const item = byUrl.get(span.url)!;
    const drop = dropped(item);
    let { start, end } = span;
    if (drop) {
      // A link that is not yours is removed; if it was alone on its line the empty line goes too.
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const nl = text.indexOf("\n", end);
      const lineEnd = nl < 0 ? text.length : nl;
      if (lineStart >= cursor && !text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) { start = lineStart; end = nl < 0 ? lineEnd : lineEnd + 1; }
    }
    message += text.slice(cursor, start);
    const shown: string = drop ? "" : settings?.converter_label_style === "link" ? item.converted ?? span.url : linkLabel(item.store);
    const newStart = message.length;
    message += shown;
    replacements.push({ start, end, newStart, newEnd: message.length });
    if (!drop) labelEntities.push({ type: "text_link", offset: newStart, length: shown.length, url: item.converted });
    cursor = end;
  }
  message += text.slice(cursor);

  const position = (offset: number) => offset + replacements.filter((r) => r.end <= offset).reduce((n, r) => n + (r.newEnd - r.newStart) - (r.end - r.start), 0);
  const overlapsSpan = (e: Entity) => spans.some((s) => e.offset < s.end && e.offset + e.length > s.start);
  const keptEntities = entities
    .filter((e) => !((e.type === "url" || e.type === "text_link") && overlapsSpan(e)))
    .filter((e) => !(e.type === "text_link" && e.url && byUrl.has(e.url) && dropped(byUrl.get(e.url))))
    .map((entity) => {
      const start = position(entity.offset);
      const end = position(entity.offset + entity.length);
      return { ...entity, offset: start, length: end - start, ...(entity.type === "text_link" && entity.url ? { url: byUrl.get(entity.url)?.converted || entity.url } : {}) };
    });

  return { message, entities: [...keptEntities, ...labelEntities], items };
}
