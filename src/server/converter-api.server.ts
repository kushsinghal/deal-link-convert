// Converter API for your other websites: one secret key, convert-only, ExtraPe first then Sankmo (EarnKaro never used).
import crypto from "node:crypto";
import { mongo } from "./db.server";
import { getSettings, HttpError } from "./core.server";
import { cleanAffiliate, socialLink } from "./affiliate.server";
import { detectStore, findUrls, isShortLink } from "./engine.server";
import { takeRateLimit } from "./rate-limit.server";

const MAX_LINKS = 20;
const PER_MINUTE = 120;
const hash = (k: string) => crypto.createHash("sha256").update(k).digest("hex");
const col = async () => (await mongo()).collection("converter_api");

export async function apiKeyStatus() {
  const row: any = await (await col()).findOne({ _id: "main" as any }, { projection: { _id: 0, hash: 0 } });
  return { has_key: !!row?.hint, hint: row?.hint || null, created_at: row?.created_at || null, last_used_at: row?.last_used_at || null, uses: row?.uses || 0, order: ["ExtraPe", "Sankmo"], per_minute: PER_MINUTE, max_links: MAX_LINKS };
}

/** A new key replaces the old one at once; the full key is shown only now. */
export async function newApiKey() {
  const key = `dl_${crypto.randomBytes(24).toString("base64url")}`;
  await (await col()).updateOne({ _id: "main" as any }, { $set: { hash: hash(key), hint: `dl_••••${key.slice(-4)}`, created_at: new Date().toISOString(), uses: 0, last_used_at: null } }, { upsert: true });
  return { key, ...(await apiKeyStatus()) };
}

export async function removeApiKey() {
  await (await col()).updateOne({ _id: "main" as any }, { $unset: { hash: "", hint: "" }, $set: { removed_at: new Date().toISOString() } });
  return apiKeyStatus();
}

async function checkKey(request: Request) {
  const given = (request.headers.get("x-api-key") || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")).trim();
  if (!given) throw new HttpError(401, "Send your DealLoot converter key in the X-API-Key header");
  const row: any = await (await col()).findOne({ _id: "main" as any });
  const a = Buffer.from(hash(given)), b = Buffer.from(String(row?.hash || ""));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, "Wrong or old converter key");
  if (!await takeRateLimit("converter-api", PER_MINUTE, 60_000)) throw new HttpError(429, `Too many links: up to ${PER_MINUTE} requests per minute`);
}

/** Your saved tokens, with the converter order fixed to ExtraPe → Sankmo and EarnKaro switched off. */
async function apiSettings() {
  const s = await getSettings();
  return { ...s, converter_order: ["extrape", "sankmo", "earnkaro"], converter_disabled: [...new Set([...(s.converter_disabled || []), "earnkaro"])], affiliate_chains: {}, affiliate_routes: {} };
}

const shopLink = (u: string) => { try { return !socialLink(u) && (detectStore(u) !== "Other" || isShortLink(u)); } catch { return false; } };

async function convertOne(url: string, settings: any) {
  const original = String(url || "").trim();
  if (!/^https?:\/\//i.test(original) || original.length > 2048) return { ok: false, original, converted: null, store: null, service: null, error: "Not a valid http(s) link" };
  const { hedgedConvert } = await import("./private-reader.server");
  const conv = await import("./telegram-converter.server");
  const db = await mongo();
  const step: any = await cleanAffiliate(original, settings, true);
  if (!step.pending || step.store === "Other") return { ok: false, original, converted: null, store: step.store, service: null, error: step.own ? "Already your affiliate link" : "Not a supported shop link" };
  const key = conv.reuseKey(step.cleaned);
  const hit = (await conv.recall(db, [key])).get(key);
  if (hit?.converted) return { ok: true, original, converted: hit.converted, store: step.store, service: hit.service || null, cached: true, error: null };
  const r: any = await hedgedConvert(step, settings);
  const ok = !r?.error && r?.changed && r.converted;
  if (ok && !r.shared) void conv.remember(db, [[key, { converted: r.converted, service: r.service || null }, 7 * 86400_000]]).catch(() => {});
  return ok ? { ok: true, original, converted: r.converted, store: step.store, service: r.service || null, cached: false, error: null }
    : { ok: false, original, converted: null, store: step.store, service: null, error: String(r?.error || "Not converted").slice(0, 200) };
}

/** Body: {"url": "..."} or {"urls": [...]} or {"text": "post with links"}. Unconverted links come back with ok:false. */
export async function apiConvert(request: Request, body: any) {
  await checkKey(request);
  const settings = await apiSettings();
  const text = typeof body.text === "string" ? body.text : null;
  const list: string[] = text !== null ? [...new Set(findUrls(text).map((u) => u.replace(/[.,;!]+$/, "")).filter(shopLink))]
    : Array.isArray(body.urls) ? body.urls.map(String) : body.url ? [String(body.url)] : [];
  if (!list.length) throw new HttpError(400, text !== null ? "No shop links found in text" : "Send {\"url\": \"https://...\"}, {\"urls\": [...]} or {\"text\": \"...\"}");
  if (list.length > MAX_LINKS) throw new HttpError(400, `Up to ${MAX_LINKS} links per request`);
  const started = Date.now();
  const results = await Promise.all(list.map((u) => convertOne(u, settings).catch((e) => ({ ok: false, original: u, converted: null, store: null, service: null, error: String(e?.message || e).slice(0, 200) }))));
  void (await col()).updateOne({ _id: "main" as any }, { $set: { last_used_at: new Date().toISOString() }, $inc: { uses: results.filter((r) => r.ok).length } }).catch(() => {});
  const ms = Date.now() - started;
  if (text !== null) {
    let out = text;
    for (const r of results) if (r.ok) out = out.split(r.original).join(r.converted!);
    return { text: out, results, converted: results.filter((r) => r.ok).length, ms };
  }
  return body.url && !Array.isArray(body.urls) ? { ...results[0], ms } : { results, converted: results.filter((r) => r.ok).length, ms };
}
