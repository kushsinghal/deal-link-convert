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
const logsCol = async () => (await mongo()).collection("converter_api_logs");

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
  if (!/^https?:\/\//i.test(original) || original.length > 2048) return { ok: false, original, cleaned: null as string | null, converted: null, store: null, service: null, status: "unsupported" as const, error: "Not a valid http(s) link" };
  const { hedgedConvert } = await import("./private-reader.server");
  const conv = await import("./telegram-converter.server");
  const db = await mongo();
  const step: any = await cleanAffiliate(original, settings, true);
  if (!step.pending || step.store === "Other") {
    return {
      ok: false, original, cleaned: step.cleaned || null, converted: null, store: step.store, service: null,
      status: step.own ? ("own" as const) : ("unsupported" as const),
      error: step.own ? "Already your affiliate link" : "Not a supported shop link",
    };
  }
  const key = conv.reuseKey(step.cleaned);
  const hit = (await conv.recall(db, [key])).get(key);
  if (hit?.converted) return { ok: true, original, cleaned: step.cleaned, converted: hit.converted, store: step.store, service: hit.service || null, cached: true, status: "converted" as const, error: null };
  const r: any = await hedgedConvert(step, settings);
  const ok = !r?.error && r?.changed && r.converted;
  if (ok && !r.shared) void conv.remember(db, [[key, { converted: r.converted, service: r.service || null }, 7 * 86400_000]]).catch(() => {});
  return ok
    ? { ok: true, original, cleaned: step.cleaned, converted: r.converted, store: step.store, service: r.service || null, cached: false, status: "converted" as const, error: null }
    : { ok: false, original, cleaned: step.cleaned, converted: null, store: step.store, service: null, status: "failed" as const, error: String(r?.error || "Not converted").slice(0, 200) };
}

/** Body: {"url": "..."} or {"urls": [...]} or {"text": "post with links"}. Unconverted links come back with ok:false. */
export async function apiConvert(request: Request, body: any) {
  await checkKey(request);
  const settings = await apiSettings();
  const text = typeof body.text === "string" ? body.text : null;
  const mode = text !== null ? "text" : Array.isArray(body.urls) ? "urls" : "url";
  const list: string[] = text !== null ? [...new Set(findUrls(text).map((u) => u.replace(/[.,;!]+$/, "")).filter(shopLink))]
    : Array.isArray(body.urls) ? body.urls.map(String) : body.url ? [String(body.url)] : [];
  if (!list.length) throw new HttpError(400, text !== null ? "No shop links found in text" : "Send {\"url\": \"https://...\"}, {\"urls\": [...]} or {\"text\": \"...\"}");
  if (list.length > MAX_LINKS) throw new HttpError(400, `Up to ${MAX_LINKS} links per request`);
  const started = Date.now();
  const rawResults = await Promise.all(list.map((u) => convertOne(u, settings).catch((e) => ({ ok: false, original: u, cleaned: null as string | null, converted: null, store: null, service: null, status: "failed" as const, error: String(e?.message || e).slice(0, 200) }))));
  const ms = Date.now() - started;
  const now = new Date().toISOString();
  const caller = (request.headers.get("origin") || request.headers.get("referer") || "").slice(0, 200) || null;
  void (await col()).updateOne({ _id: "main" as any }, { $set: { last_used_at: now }, $inc: { uses: rawResults.filter((r) => r.ok).length } }).catch(() => {});
  const logRows = rawResults.map((r) => ({
    id: crypto.randomUUID(),
    created_at: now,
    mode,
    caller,
    status: r.status,
    original: r.original,
    cleaned: r.cleaned,
    converted: r.converted,
    store: r.store,
    service: r.service,
    cached: !!(r as any).cached,
    error: r.error,
    ms,
  }));
  void (await logsCol()).insertMany(logRows).catch(() => {});
  const results = rawResults.map(({ cleaned: _c, status: _s, ...pub }) => pub);
  if (text !== null) {
    let out = text;
    for (const r of results) if (r.ok) out = out.split(r.original).join(r.converted!);
    return { text: out, results, converted: results.filter((r) => r.ok).length, ms };
  }
  return body.url && !Array.isArray(body.urls) ? { ...results[0], ms } : { results, converted: results.filter((r) => r.ok).length, ms };
}

export async function apiLogs(limit = 200) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const [status, logs] = await Promise.all([
    apiKeyStatus(),
    (await logsCol()).find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(n).toArray(),
  ]);
  const counts = { converted: 0, own: 0, failed: 0, unsupported: 0, cached: 0 };
  const by_service: Record<string, number> = {};
  const by_store: Record<string, number> = {};
  for (const row of logs as any[]) {
    if (row.status in counts) (counts as any)[row.status]++;
    if (row.cached) counts.cached++;
    if (row.status === "converted" && row.service) by_service[row.service] = (by_service[row.service] || 0) + 1;
    if (row.store && row.store !== "Other") by_store[row.store] = (by_store[row.store] || 0) + 1;
  }
  return {
    status,
    summary: { total: logs.length, ...counts, by_service, by_store },
    logs,
  };
}

export async function clearApiLogs() {
  await (await logsCol()).deleteMany({});
  return { ok: true };
}
