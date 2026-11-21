import * as engine from "./engine.server";
import { mongo } from "./db.server";
import { normalizeSource } from "./source-input.server";

export const NITTER_MIRRORS = ["nitter.net", "xcancel.com", "nitter.poast.org", "nitter.mie.foundation", "nitter.mizuki.st", "nitter.privacydev.net"];
const X_MIN_GAP_MS = 30 * 60e3;
const statusId = (s: string) => /status(?:es)?\/(\d{5,25})/.exec(s || "")?.[1];

export function nitterUser(url: string) {
  const m = /^https?:\/\/(?:[^/]*nitter[^/]*|xcancel\.com)\/([A-Za-z0-9_]{1,15})\/rss\/?$/i.exec(String(url || "").trim());
  return m?.[1] || "";
}

export function xUsername(src: any) {
  return String(src.x_username || (src.kind === "x" ? src.value : src.kind === "rss" ? nitterUser(src.value) : "") || "").replace(/^@/, "");
}

export function backupUrls(src: any) {
  const user = xUsername(src);
  const mirrors = user ? NITTER_MIRRORS.filter((h) => !src.value.includes(`//${h}/`)).slice(0, 5).map((h) => `https://${h}/${user}/rss`) : [];
  return [...new Set([...(src.backup_urls || []).slice(0, 5), ...mirrors])].filter((u) => u !== src.value);
}

async function xGet(path: string) {
  const token = (process.env["X_BEARER_TOKEN"] || "").trim();
  if (!token) throw new Error("X API: add X_BEARER_TOKEN first");
  const r = await fetch(`https://api.x.com${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  const data: any = await r.json().catch(() => ({}));
  if (r.status === 429) {
    const reset = Number(r.headers.get("x-rate-limit-reset"));
    throw new Error(`X API rate limit reached${reset ? `, resets ${new Date(reset * 1000).toISOString()}` : ""}`);
  }
  if (!r.ok) throw new Error(`X API ${r.status}: ${data?.detail || data?.title || data?.errors?.[0]?.message || "request failed"}`);
  return data;
}

async function xUserId(username: string) {
  const col = (await mongo()).collection("x_users");
  const hit = await col.findOne({ username: username.toLowerCase() });
  if (hit?.x_id) return hit.x_id;
  const data = await xGet(`/2/users/by/username/${encodeURIComponent(username)}`);
  if (!data?.data?.id) throw new Error(`X API: account @${username} not found`);
  await col.updateOne({ username: username.toLowerCase() }, { $set: { x_id: data.data.id } }, { upsert: true });
  return data.data.id;
}

export function mapTweets(data: any, username: string) {
  const media = new Map<string, string>((data?.includes?.media || []).map((m: any) => [m.media_key, m.url || m.preview_image_url]));
  return (data?.data || []).map((t: any) => {
    let text = t.note_tweet?.text || t.text || "";
    const urls = t.note_tweet?.entities?.urls || t.entities?.urls || [];
    const links: string[] = [];
    for (const u of urls) {
      const real = u.unwound_url || u.expanded_url || u.url;
      text = text.split(u.url).join(/(?:x|twitter)\.com\/\w+\/status\//i.test(real) ? "" : real);
      if (!/(?:x|twitter)\.com\//i.test(real)) links.push(real);
    }
    const image = (t.attachments?.media_keys || []).map((k: string) => media.get(k)).find(Boolean) || null;
    return { ext_id: t.id, text: text.trim(), links, image, posted_at: t.created_at || null, post_url: `https://x.com/${username}/status/${t.id}` };
  });
}

const env = (k: string) => (process.env[k] || "").trim();
const hasOfficialToken = () => env("X_BEARER_TOKEN").startsWith("AAAA");
export const xReady = () => !!(env("X_AUTH_TOKEN") && env("X_CT0")) || hasOfficialToken();

export function mapScraped(tweets: any[], username: string) {
  return tweets.map((t) => {
    const links = (t.urls || []).filter((u: string) => !/(?:x|twitter)\.com\//i.test(u));
    let text = String(t.text || "").replace(/https?:\/\/t\.co\/\w+/g, "").trim();
    for (const u of links) if (!text.includes(u)) text += `\n${u}`;
    return { ext_id: t.id, text: text.trim(), links, image: t.photos?.[0]?.url || null, posted_at: t.timeParsed ? new Date(t.timeParsed).toISOString() : null, post_url: t.permanentUrl || `https://x.com/${username}/status/${t.id}` };
  });
}

let scraper: any = null;
// Reads with a spare account's login cookies (unofficial; X may lock that account).
async function fetchXCookie(username: string) {
  if (!scraper) {
    const { Scraper } = await import("@the-convocation/twitter-scraper");
    const s = new Scraper({ fetch: (input: any, init: any) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }), rateLimitStrategy: { onRateLimit: async () => { throw new Error("X rate limit reached; try later"); } } });
    await s.setCookies([`auth_token=${env("X_AUTH_TOKEN")}; Domain=.x.com; Path=/; Secure; HttpOnly`, `ct0=${env("X_CT0")}; Domain=.x.com; Path=/; Secure`]);
    scraper = s;
  }
  const out: any[] = [];
  try {
    for await (const t of scraper.getTweets(username, 10)) {
      if (!t.isRetweet && !t.isReply) out.push(t);
      if (out.length >= 10) break;
    }
  } catch (e: any) {
    scraper = null;
    const msg = String(e?.message || e);
    throw new Error(/401|403|auth|login/i.test(msg) ? `X cookie login rejected: log in to the spare X account again and update X_AUTH_TOKEN and X_CT0 (${msg.slice(0, 120)})` : `X read failed: ${msg.slice(0, 200)}`);
  }
  return mapScraped(out, username);
}

/** Reads recent posts of an X account; at most once per 30 minutes per account to protect the account and credits. */
export async function fetchX(username: string, force = false) {
  username = username.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new Error("X API: invalid username");
  const col = (await mongo()).collection("x_users");
  const state = await col.findOne({ username: username.toLowerCase() });
  if (!force && state?.last_at && Date.now() - new Date(state.last_at).getTime() < X_MIN_GAP_MS) {
    if (Array.isArray(state.items)) return state.items;
    throw new Error("X backup is cooling down; try again later");
  }
  if (env("X_AUTH_TOKEN") && env("X_CT0")) {
    try {
      const items = await fetchXCookie(username);
      await col.updateOne({ username: username.toLowerCase() }, { $set: { items, last_at: new Date().toISOString() } }, { upsert: true });
      return items;
    } catch (e) {
      void import("./telegram-converter.server").then(t => t.alertIfKeyFailed(String((e as Error).message))).catch(() => {});
      if (!hasOfficialToken()) throw e;
    }
  }
  if (!hasOfficialToken()) throw new Error("X: add the spare account's X_AUTH_TOKEN and X_CT0 cookies first");
  const id = await xUserId(username);
  const q = new URLSearchParams({ max_results: "10", exclude: "retweets,replies", "tweet.fields": "created_at,entities,attachments,note_tweet", expansions: "attachments.media_keys", "media.fields": "url,preview_image_url" });
  const data = await xGet(`/2/users/${id}/tweets?${q}`);
  const items = mapTweets(data, username);
  await col.updateOne({ username: username.toLowerCase() }, { $set: { items, last_at: new Date().toISOString() } }, { upsert: true });
  return items;
}

export const generatedRss = (username: string) => `https://${NITTER_MIRRORS[0]}/${normalizeSource("x", username)}/rss`;

const tweetIds = (items: any[]) => items.map((it) => ({ ...it, ext_id: statusId(it.ext_id) || statusId(it.post_url) || it.ext_id }));

/** A working RSS URL becomes preferred; original input and configured backups are never overwritten. */
export async function fetchSourceItems(src: any): Promise<{ items: any[]; via: string | null }> {
  const errors: string[] = [];
  const isTwitter = src.kind === "x" || !!xUsername(src);
  if (src.kind === "telegram" || src.kind === "web") {
    try { return { items: await (src.kind === "telegram" ? engine.fetchTelegram(src.value) : engine.fetchWeb(src.value)), via: null }; }
    catch (e: any) { errors.push(`Main: ${e.message}`); }
  }
  const main = src.kind === "x" ? generatedRss(src.value) : src.kind === "rss" ? src.value : "";
  const candidates = [...new Set([main, ...backupUrls(src)].filter(Boolean))];
  if (src.preferred_feed && candidates.includes(src.preferred_feed)) candidates.splice(candidates.indexOf(src.preferred_feed), 1), candidates.unshift(src.preferred_feed);
  let empty: { items: any[]; via: string | null } | null = null;
  for (const url of candidates) {
    try {
      const raw = await engine.fetchRss(normalizeSource("rss", url), { timeoutMs: 2500, attempts: 1 });
      if (isTwitter && !raw.length) { empty = { items: [], via: url }; continue; }
      if (src.id) await (await mongo()).collection("sources").updateOne({ id: src.id }, { $set: { preferred_feed: url, last_via: url } });
      return { items: isTwitter ? tweetIds(raw) : raw, via: url };
    } catch (e: any) { errors.push(`${new URL(url).hostname}: ${e?.message || e}`); }
  }
  const user = xUsername(src);
  if (user && xReady()) {
    try { return { items: await fetchX(user), via: "X backup" }; } catch (e: any) { errors.push(String(e?.message || e)); }
  }
  if (empty && !errors.length) return empty;
  throw new Error((errors.join(" | ") || "No readable RSS feed; X backup is not configured").slice(0, 600));
}

const pendingReads = new Map<string, Promise<any>>();
export async function recentTweets(input: string, count = 7) {
  const username = normalizeSource("x", input).toLowerCase();
  const limit = Math.min(7, Math.max(5, Math.trunc(count) || 7));
  let job = pendingReads.get(username);
  if (!job) {
    job = readRecent(username).finally(() => pendingReads.delete(username));
    pendingReads.set(username, job);
  }
  const result = await job;
  return { ...result, items: result.items.slice(0, limit) };
}

async function readRecent(username: string) {
  const db = await mongo(), cache = db.collection("x_display_cache");
  const old = await cache.findOne({ _id: username as any }, { projection: { _id: 0 } });
  const cached = old?.items?.length && Date.now() - new Date(old.fetched_at).getTime() < 86400e3;
  if (cached && Date.now() - new Date(old.fetched_at).getTime() < 5 * 60e3) return { username, items: old.items, via: old.via, fetched_at: old.fetched_at, cached: true, stale: false };
  if (old?.retry_after > Date.now()) {
    if (cached) return { username, items: old.items, via: old.via, fetched_at: old.fetched_at, cached: true, stale: true };
    throw new Error("Posts unavailable right now. Please try again in a minute.");
  }
  const sources = await db.collection("sources").find({ $or: [{ kind: "x" }, { kind: "rss" }] }, { projection: { _id: 0 } }).limit(200).toArray();
  const source = sources.find((s: any) => xUsername(s).toLowerCase() === username) || { kind: "x", value: username, preferred_feed: old?.preferred_feed };
  try {
    const result = await fetchSourceItems(source);
    const items = [...new Map(result.items.map(it => [it.ext_id, it])).values()].sort((a: any, b: any) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0)).slice(0, 10);
    const xState = result.via === "X backup" ? await db.collection("x_users").findOne({ username }, { projection: { _id: 0, last_at: 1 } }) : null;
    const fetched_at = xState?.last_at || new Date().toISOString();
    await cache.updateOne({ _id: username as any }, { $set: { items, via: result.via, fetched_at, retry_after: 0, preferred_feed: result.via?.startsWith("http") ? result.via : source.preferred_feed, expires_at: new Date(Date.now() + 86400e3) } }, { upsert: true });
    return { username, items, via: result.via, fetched_at, cached: !!xState && Date.now() - Date.parse(fetched_at) > 1000, stale: false };
  } catch (e) {
    await cache.updateOne({ _id: username as any }, { $set: { retry_after: Date.now() + 60e3, expires_at: new Date(Date.now() + 86400e3) } }, { upsert: true });
    if (cached) return { username, items: old.items, via: old.via, fetched_at: old.fetched_at, cached: true, stale: true };
    throw e;
  }
}

export function xAccessStatus() {
  return { cookies_configured: !!(env("X_AUTH_TOKEN") && env("X_CT0")), official_configured: hasOfficialToken(), rss_enabled: true };
}
