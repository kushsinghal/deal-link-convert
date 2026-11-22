// Builds the new post from a source post's text. Pure functions, no network.

const NOT_TITLE = /https?:\/\/|₹|^(?:mrp|price|seller|discounted)\b|super\s*coins?|back in stock|false alert|blinked|\bOOS\b|pincodes?|locations?|still available|complete list|before purchasing|faqs?\b|redemption|was there for|lasted \d/i;
const LEADING_SYMBOL = /^[^\p{L}\p{N}]+/u;

export type ParsedDeal = { title: string | null; price: string | null; coins: string | null; seller: string | null; supercoin: boolean };

export function parseDeal(text: string): ParsedDeal {
  const lines = String(text || "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let title: string | null = null, price: string | null = null, discounted: string | null = null, sellerPrice: string | null = null, coins: string | null = null, seller: string | null = null;
  for (const raw of lines) {
    const l = raw.replace(LEADING_SYMBOL, "").trim();
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^discounted\s*price\s*:\s*₹\s*([\d,]+(?:\.\d+)?)/i))) { discounted = m[1] ?? null; continue; }
    if ((m = l.match(/^(?:selling\s*)?price\s*:\s*₹\s*([\d,]+(?:\.\d+)?)/i))) { price ??= m[1] ?? null; continue; }
    if ((m = l.match(/^super\s*coins?\s*(?:back|cashback)?\s*:\s*₹?\s*([\d,]+)/i))) { coins ??= m[1] ?? null; continue; }
    if ((m = l.match(/^([\d,]+)\s*super\s*coins?\s*(?:back|cashback)/i))) { coins ??= m[1] ?? null; continue; }
    if ((m = l.match(/^seller\s*[:\-]\s*(.+)$/i))) {
      const [name, rest] = String(m[1]).split(/\s*·\s*/);
      seller = name?.trim() || null;
      sellerPrice = rest?.match(/₹\s*([\d,]+(?:\.\d+)?)/)?.[1] || null;
      continue;
    }
    if (!title && l.length >= 6 && /[a-z]/i.test(l) && !NOT_TITLE.test(l)) title = l;
  }
  return { title, price: discounted || price || sellerPrice, coins, seller, supercoin: /super\s*coins?/i.test(text || "") };
}

export const priceNumber = (price: string | null) => (price ? Number(price.replace(/,/g, "")) || 0 : 0);

/** Caption (or the automatic header) at the top, then the product and only your links. */
export function buildPost(deal: ParsedDeal, links: { store: string; url: string }[], caption = "") {
  const header = caption.trim() || (deal.supercoin ? "Supercoin Deals" : `${links[0]?.store || "Flipkart"} Deal`);
  const parts = [header];
  if (deal.title) parts.push(deal.title);
  if (deal.price) parts.push(`Price: ₹${deal.price}`);
  if (deal.coins) parts.push(`SuperCoins: ${deal.coins} SuperCoins cashback`);
  if (deal.seller) parts.push(`Seller: ${deal.seller}`);
  const stores = [...new Set(links.map((l) => l.store))];
  parts.push(`Buy on ${stores.length === 1 && stores[0] !== "Other" ? stores[0] : "store"}:\n${links.map((l) => l.url).join("\n")}`);
  return parts.join("\n\n");
}

/** Every link in a gramjs message: visible text, hidden text links and URL buttons. */
export function messageLinks(message: any): string[] {
  const text = String(message?.message || "");
  const out: string[] = [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0]);
  for (const e of message?.entities || []) {
    if (e.url) out.push(e.url);
    else if (e.className === "MessageEntityUrl") {
      const raw = text.slice(e.offset, e.offset + e.length);
      if (!/^https?:\/\//i.test(raw) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) out.push(`https://${raw}`);
    }
  }
  for (const row of message?.replyMarkup?.rows || []) for (const b of row.buttons || []) { const url = b.url || b.type?.url; if (typeof url === "string") out.push(url); }
  return [...new Set(out.map((u) => u.replace(/[.,;!]+$/, "")))].slice(0, 10);
}
