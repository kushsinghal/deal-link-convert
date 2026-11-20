import * as engine from "./engine.server";
import { mongo } from "./db.server";

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
  const user = src.kind === "rss" ? nitterUser(src.value) : "";
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

/** Reads recent posts of an X account; at most once per 30 minutes per account to protect API credits. */
export async function fetchX(username: string, force = false) {
  username = username.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new Error("X API: invalid username");
  const col = (await mongo()).collection("x_users");
  const state = await col.findOne({ username: username.toLowerCase() });
  if (!force && state?.last_at && Date.now() - new Date(state.last_at).getTime() < X_MIN_GAP_MS) throw new Error("X API: skipped, last read was under 30 minutes ago (credit protection)");
  const id = await xUserId(username);
  const q = new URLSearchParams({ max_results: "10", exclude: "retweets,replies", "tweet.fields": "created_at,entities,attachments,note_tweet", expansions: "attachments.media_keys", "media.fields": "url,preview_image_url" });
  if (state?.since_id && !force) q.set("since_id", state.since_id);
  const data = await xGet(`/2/users/${id}/tweets?${q}`);
  await col.updateOne({ username: username.toLowerCase() }, { $set: { last_at: new Date().toISOString(), ...(data?.meta?.newest_id ? { since_id: data.meta.newest_id } : {}) } }, { upsert: true });
  return mapTweets(data, username);
}

function primary(src: any) {
  if (src.kind === "telegram") return engine.fetchTelegram(src.value);
  if (src.kind === "web") return engine.fetchWeb(src.value);
  if (src.kind === "x") return fetchX(src.value);
  return engine.fetchRss(src.value);
}

const tweetIds = (items: any[]) => items.map((it) => ({ ...it, ext_id: statusId(it.ext_id) || statusId(it.post_url) || it.ext_id }));

/** Main source first, then up to 5 backup feeds, then the X API. */
export async function fetchSourceItems(src: any): Promise<{ items: any[]; via: string | null }> {
  const errors: string[] = [];
  const isTwitter = src.kind === "x" || !!xUsername(src);
  try { const items = await primary(src); return { items: isTwitter ? tweetIds(items) : items, via: null }; } catch (e: any) { errors.push(`Main: ${e?.message || e}`); }
  if (src.kind !== "x") {
    for (const url of backupUrls(src)) {
      try { return { items: isTwitter ? tweetIds(await engine.fetchRss(url)) : await engine.fetchRss(url), via: url }; } catch (e: any) { errors.push(`${new URL(url).hostname}: ${e?.message || e}`); }
    }
    const user = xUsername(src);
    if (user && process.env["X_BEARER_TOKEN"]) {
      try { return { items: await fetchX(user), via: "X API" }; } catch (e: any) { errors.push(String(e?.message || e)); }
    }
  }
  throw new Error(errors.join(" | ").slice(0, 600));
}
