import crypto, { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { mongo } from "./db.server";
import { getSettings, publishConversion } from "./core.server";
import { cleanAffiliate, finishAffiliate, findLinks, renderConverted, socialLink } from "./affiliate.server";
import { productKey, isShortLink, isDealSite, detectStore } from "./engine.server";
import { BOT_COMMANDS, BOT_HELP } from "../lib/bot-commands";

const tokenSchema = z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/, "Enter the bot token from BotFather");
const entity = z.object({ type: z.string().max(40), offset: z.number().int().min(0), length: z.number().int().min(0), url: z.string().url().max(4096).optional() }).passthrough();
const messageSchema = z.object({ message_id: z.number().int(), chat: z.object({ id: z.number().int(), type: z.enum(["private", "group", "supergroup", "channel"]) }).passthrough(), from: z.object({ is_bot: z.boolean().optional() }).passthrough().optional(), text: z.string().max(4096).optional(), caption: z.string().max(1024).optional(), entities: z.array(entity).max(100).optional(), caption_entities: z.array(entity).max(100).optional() }).passthrough();
const updateSchema = z.object({ update_id: z.number().int().min(0), message: messageSchema.optional(), channel_post: messageSchema.optional() }).passthrough();

function sign(value: string) {
  const key = process.env["SESSION_SECRET"];
  if (!key) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", key).update(value).digest("hex");
}
function equal(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export const webhookSecret = (token: string) => sign(`telegram-converter:${token}`);
export function pairingCode(token: string) {
  const expiry = Date.now() + 15 * 60_000;
  return `${expiry}_${sign(`telegram-pair:${token}:${expiry}`)}`;
}
export function validPairing(code: string, token: string) {
  const match = code.match(/^(\d{13})_([a-f0-9]{64})$/);
  return !!match?.[1] && !!match?.[2] && Number(match[1]) > Date.now() && equal(match[2], sign(`telegram-pair:${token}:${match[1]}`));
}

/** attempts: 1 for new posts, where a timed-out send may already have arrived and a retry would post twice. */
export async function telegramCall(token: string, method: string, body: Record<string, unknown>, attempts = 3) {
  tokenSchema.parse(token);
  let response: Response | undefined;
  for (let attempt = 0; !response; attempt++) {
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    } catch (e: any) {
      console.error("Telegram network error", method, attempt, e?.cause?.code || e?.name || "unknown");
      if (attempt >= attempts - 1) throw new Error("Telegram could not be reached. Try again.");
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { throw new Error(`Telegram returned an invalid response (${response.status})`); }
  if (!response.ok || !data.ok) {
    const detail = String(data.description || "Request failed").replaceAll(token, "[redacted]");
    console.error("Telegram converter request failed", response.status, detail);
    throw new Error(`Telegram (${response.status}): ${detail}`);
  }
  return data.result;
}

const RADHE = /^(?:\/radhe(?:@\w+)?|@radhe|radhe(?:\s+radhe)*)$/i;
const PLAIN_START = /^\/start(?:@\w+)?$/i;
const EXTRAPE_KEY_ERROR = /ExtraPe access token expired or invalid|Add your ExtraPe access token/i;
const botId = (token: string) => token.split(":")[0];
const STATUS = /^\/status(?:@\w+)?$/i;
const STYLE = /^\/style(?:@\w+)?(?:\s+(\S+))?$/i;
const chatName = (chat: any) => String(chat.title || (chat.username ? `@${chat.username}` : "") || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "").slice(0, 120) || null;

/** Text for /status: live converter key checks plus each feed's last health check. */
export async function statusReport(settings: any) {
  const { testConverterKeys } = await import("./engine.server");
  const icon: Record<string, string> = { ok: "✅", error: "❌", empty: "⚪", "not set": "➖" };
  const keys = (await testConverterKeys(settings)).map((k: any) => `${icon[k.status] || "❔"} ${k.name}: ${k.status}${k.error ? ` — ${k.error.slice(0, 120)}` : ""}`);
  const sources = await (await mongo()).collection("sources").find({ enabled: { $ne: false } }, { projection: { _id: 0, name: 1, health: 1, last_fetched_at: 1, last_error: 1, fail_streak: 1 } }).toArray();
  for (const source of sources) if (source.last_fetched_at && (!source.health?.checked_at || source.last_fetched_at > source.health.checked_at)) source.health = { status: source.last_error ? "error" : "ok", message: source.last_error || "Last scan successful" };
  const ok = sources.filter((s: any) => s.health?.status === "ok").length;
  const bad = sources.filter((s: any) => s.health?.status !== "ok").map((s: any) => `${icon[s.health?.status] || "❔"} ${s.name}: ${s.health ? `${s.health.status}${s.health.message ? ` — ${String(s.health.message).slice(0, 80)}` : ""}` : "not tested yet"}`);
  return [`🔑 Keys (live check)`, ...keys, "", `📡 Feeds: ${ok}/${sources.length} working (last check)`, ...bad.slice(0, 40)].join("\n").slice(0, 4000);
}

async function connectedChats(token: string) {
  return (await mongo()).collection("telegram_converter_chats").find({ bot: botId(token) }, { projection: { _id: 0, chat_id: 1, type: 1 } }).toArray();
}

/** Sends a message to every connected converter chat; same alert key is sent at most once per 6 hours. */
export async function notifyOwner(text: string, alertKey?: string) {
  const settings = await getSettings();
  const token = settings.telegram_converter_token;
  if (!token) return 0;
  const db = await mongo();
  if (alertKey) {
    try {
      await db.collection("converter_alerts").updateOne({ _id: alertKey as any, at: { $lte: Date.now() - 6 * 3600_000 } }, { $set: { at: Date.now() } }, { upsert: true });
    } catch (e: any) {
      if (e?.code === 11000) return 0;
      throw e;
    }
  }
  let sent = 0;
  for (const chat of await connectedChats(token)) {
    if (chat.type === "channel") continue;
    try { await telegramCall(token, "sendMessage", { chat_id: chat.chat_id, text }); sent++; } catch (e) { console.error("owner alert failed", (e as Error).message); }
  }
  if (alertKey && !sent) await db.collection("converter_alerts").deleteOne({ _id: alertKey as any });
  return sent;
}

const KEY_ALERTS: [string, RegExp, string][] = [
  ["extrape-key", EXTRAPE_KEY_ERROR, "⚠️ ExtraPe key problem: your links are NOT being converted to your ExtraPe links.\n\nExtraPe says your access token is expired or invalid. Log in to extrape.com, copy the new token and update it in Control Room → Affiliate Setup."],
  ["earnkaro-key", /EarnKaro[^;]*(?:\b401\b|\b403\b|unauthori[sz]ed|invalid[^;]*token|token[^;]*(?:expired|invalid)|jwt|log ?in)/i, "⚠️ EarnKaro key problem: EarnKaro rejected your API token, so it can't convert links.\n\nOpen EarnKaro, copy a fresh API token and update it in Control Room → Affiliate Setup."],
  ["sankmo-key", /Sankmo[^;]*(?:Invalid Token|log in with your Telegram|AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED|\b401\b|\b403\b)/i, "⚠️ Sankmo problem: Sankmo links are not converting.\n\nYour Sankmo token was rejected or the @sankmo_bot Telegram login has ended. Log in again in Control Room → Affiliate Setup → Sankmo via Telegram."],
  ["x-cookie", /X cookie login rejected|X: add the spare account/i, "⚠️ X backup problem: the spare X account's cookies stopped working, so X posts can't be read as a backup.\n\nLog in to the spare X account in your browser, copy the new auth_token and ct0 cookies and update X_AUTH_TOKEN and X_CT0."],
];

/** Sends a Telegram alert (max once per 6 hours per service) when a converter key or the X cookies stop working. */
export async function alertIfKeyFailed(error: string | null | undefined) {
  if (!error) return;
  for (const [key, re, text] of KEY_ALERTS) if (re.test(error)) await notifyOwner(`${text}\n\nDetail: ${error.slice(0, 300)}`, key);
}

/** Run by the scheduler: re-registers the webhook if Telegram lost it and tells the owner. */
export async function checkConverterHealth() {
  const settings = await getSettings();
  const token = settings.telegram_converter_token;
  if (!token || !settings.telegram_converter_connected || !settings.telegram_converter_url) return { checked: false };
  const expected = `${settings.telegram_converter_url}/api/public/telegram/converter`;
  let info: any;
  try { info = await telegramCall(token, "getWebhookInfo", {}); } catch (e) { return { checked: true, error: (e as Error).message }; }
  if (info.url === expected) return { checked: true, ok: true };
  // Another copy of the site owns the bot; take it back only if that copy is failing (e.g. a sleeping preview).
  const failing = info.last_error_date && Date.now() / 1000 - info.last_error_date < 900 && /404|5\d\d|timeout|timed out|connection|resolve/i.test(info.last_error_message || "");
  if (info.url && !failing) return { checked: true, ok: true, other_url: info.url };
  try {
    await telegramCall(token, "setWebhook", { url: expected, secret_token: webhookSecret(token), allowed_updates: ["message", "channel_post"], drop_pending_updates: false });
    await notifyOwner("🔄 The converter bot connection was lost and has been restored automatically. You can keep sending links.", "converter-restored");
    return { checked: true, restored: true };
  } catch (e) {
    await notifyOwner("❌ Disconnected: the converter bot lost its connection and could not reconnect automatically. Open Control Room → Affiliate Setup and press Connect bot.", "converter-lost");
    return { checked: true, error: (e as Error).message };
  }
}

export async function converterLogs(limit = 200) {
  return (await mongo()).collection("converter_logs").find({}, { projection: { _id: 0 } }).sort({ received_at: -1 }).limit(Math.min(500, Math.max(1, Math.trunc(limit) || 200))).toArray();
}

export async function syncBotMenu() {
  const settings = await getSettings();
  const token = tokenSchema.parse(settings.telegram_converter_token);
  await telegramCall(token, "setMyCommands", { commands: BOT_COMMANDS });
  await telegramCall(token, "setChatMenuButton", { menu_button: { type: "commands" } });
  return { ok: true, commands: BOT_COMMANDS };
}

export async function connectConverter(origin: string) {
  const settings = await getSettings();
  const token = tokenSchema.parse(settings.telegram_converter_token);
  const url = new URL(origin);
  if (url.protocol !== "https:") throw new Error("Use your HTTPS Render address to connect Telegram");
  const bot = await telegramCall(token, "getMe", {});
  await telegramCall(token, "setWebhook", { url: `${url.origin}/api/public/telegram/converter`, secret_token: webhookSecret(token), allowed_updates: ["message", "channel_post"], drop_pending_updates: false });
  const db = await mongo();
  await db.collection("settings").updateOne({ id: "main" }, { $set: { telegram_converter_username: bot.username, telegram_converter_url: url.origin, telegram_converter_connected: true } });
  settingsCache = null;
  await syncBotMenu();
  await notifyOwner("✅ Connected. The converter bot is running — send your links here.");
  return { username: bot.username, pairing_code: pairingCode(token), webhook_url: `${url.origin}/api/public/telegram/converter` };
}

export async function converterStatus() {
  const settings = await getSettings();
  if (!settings.telegram_converter_token) return { connected: false, chats: [] };
  const info = await telegramCall(settings.telegram_converter_token, "getWebhookInfo", {});
  const db = await mongo();
  const chats = await db.collection("telegram_converter_chats").find({ bot: settings.telegram_converter_token.split(":")[0] }, { projection: { _id: 0, chat_id: 1, type: 1, title: 1 } }).toArray();
  return { connected: !!info.url, webhook_url: info.url, pending: info.pending_update_count, // Telegram keeps showing its last error forever; only one from the last 10 minutes is a current problem.
    error: info.last_error_message && (info.pending_update_count > 0 || Date.now() / 1000 - (info.last_error_date || 0) < 600) ? info.last_error_message : null, chats, pairing_code: pairingCode(settings.telegram_converter_token) };
}

export async function disconnectConverter() {
  const settings = await getSettings();
  if (settings.telegram_converter_token) {
    await notifyOwner("⛔ Disconnected: the converter bot was turned off from Control Room. Links sent now will not be converted. Press Connect bot to start again.");
    await telegramCall(settings.telegram_converter_token, "deleteWebhook", {});
  }
  const db = await mongo();
  await db.collection("settings").updateOne({ id: "main" }, { $set: { telegram_converter_connected: false } });
  settingsCache = null;
  return { connected: false };
}

const DAY = 86400_000;
const LOCK_MS = 300_000;
// Render runs one copy of the site, so answers kept in memory save a database trip. The database stays the source of truth.
const local = new Map<string, { v: any; exp: number }>();
const localClaims = new Map<string, number>();
const connectedLocal = new Set<string>();
let settingsCache: { at: number; value: any } | null = null;
let indexed = false;

export function resetConverterCaches() { local.clear(); localClaims.clear(); connectedLocal.clear(); settingsCache = null; }

export const ROUTE_KEYS = ["converter_bot_service", "converter_order", "affiliate_routes", "affiliate_chains", "amazon_route", "amazon_tag", "extrape_token", "earnkaro_token", "sankmo_token", "sankmo_api_url", "convert_mode", "convert_enabled", "tg_session"];
/** Called after settings are saved: the bot reads them again, and remembered links are dropped when the converter setup changed. */
export async function settingsChanged(changed: string[]) {
  settingsCache = null;
  if (!changed.some((k) => ROUTE_KEYS.includes(k))) return;
  for (const k of local.keys()) if (k.startsWith("c:")) local.delete(k);
  await (await mongo()).collection("converter_memory").deleteMany({ _id: { $regex: "^c:" } as any });
}

async function botSettings() {
  if (!settingsCache || Date.now() - settingsCache.at > 60_000) settingsCache = { at: Date.now(), value: await getSettings() };
  return settingsCache.value;
}

function keep(id: string, v: any, exp: number) {
  if (local.size >= 5000) for (const k of [...local.keys()].slice(0, 1000)) local.delete(k);
  local.set(id, { v, exp });
}
/** Remembered answers: "s:" opened short link, "o:" link the bot made, "c:" affiliate link of a product listing. */
export async function recall(db: any, ids: string[]) {
  const out = new Map<string, any>(), now = Date.now();
  const miss = ids.filter((id) => { const hit = local.get(id); if (hit && hit.exp > now) out.set(id, hit.v); return !out.has(id); });
  if (miss.length) for (const row of await db.collection("converter_memory").find({ _id: { $in: miss }, exp: { $gt: new Date(now) } }).toArray()) { out.set(row._id, row.v); keep(row._id, row.v, +new Date(row.exp)); }
  return out;
}
export async function remember(db: any, entries: [string, any, number][]) {
  if (!entries.length) return;
  const now = Date.now();
  for (const [id, v, ttl] of entries) keep(id, v, now + ttl);
  await db.collection("converter_memory").bulkWrite(entries.map(([id, v, ttl]) => ({ updateOne: { filter: { _id: id }, update: { $set: { v, exp: new Date(now + ttl) } }, upsert: true } })), { ordered: false });
}
/** Same seller listing of the same product; other shops are matched by the exact clean link. */
export function reuseKey(cleaned: string) {
  let p: URL | null = null;
  try { p = new URL(cleaned); } catch { /* not a URL */ }
  if (p?.hostname.includes("flipkart.")) {
    const lid = p.searchParams.get("lid") || "";
    const pid = p.searchParams.get("pid") || lid.match(/^LST([A-Z0-9]{16})/)?.[1];
    if (pid) return `c:flipkart:${pid}:${lid}`;
  }
  return `c:${cleaned}`;
}

/** Marks products as posted in one chat; returns the keys that were not posted there inside the window. */
export async function claimProducts(db: any, keys: string[], windowMs: number) {
  const at = Date.now();
  // Every product was seen here moments ago by this server: a repeat, no database trip needed.
  if (keys.length && keys.every((k) => (localClaims.get(k) ?? 0) > at - windowMs)) return [];
  const col = db.collection("converter_products");
  const got = await Promise.all(keys.map(async (key) => {
    try { await col.updateOne({ _id: key, at: { $lte: at - windowMs } }, { $set: { at } }, { upsert: true }); return key; } catch (e: any) {
      if (e?.code === 11000) return null;
      throw e;
    }
  }));
  const fresh = got.filter((k): k is string => !!k);
  if (localClaims.size >= 5000) localClaims.clear();
  for (const k of fresh) localClaims.set(k, at);
  return fresh;
}
export async function releaseProducts(db: any, keys: string[]) {
  if (!keys.length) return;
  for (const k of keys) localClaims.delete(k);
  await db.collection("converter_products").deleteMany({ _id: { $in: keys } as any }).catch(() => {});
}

/** One update is handled once, even if Telegram sends it again. */
async function takeUpdate(updates: any, key: string): Promise<"go" | "done" | "busy"> {
  try { await updates.insertOne({ _id: key, locked_until: Date.now() + LOCK_MS }); return "go"; } catch (e: any) {
    if (e?.code !== 11000) throw e;
  }
  const existing = await updates.findOne({ _id: key });
  if (existing?.done) return "done";
  const claim = await updates.updateOne({ _id: key, done: { $ne: true }, locked_until: { $lte: Date.now() } }, { $set: { locked_until: Date.now() + LOCK_MS } });
  return claim.modifiedCount ? "go" : "busy";
}

const GONE = /message to edit not found|MESSAGE_ID_INVALID/i;
// A deleted post is only posted again while the deal is fresh; old updates delivered after an outage are not.
const POST_AGAIN_MS = 10 * 60_000;
/** The post was deleted before the bot could change it: the converted message goes out as a new post. */
async function postAgain(token: string, msg: any, message: string, entities: unknown[]) {
  const media: [string, string, string] | null = msg.photo?.length ? ["sendPhoto", "photo", msg.photo.at(-1).file_id] : msg.video ? ["sendVideo", "video", msg.video.file_id]
    : msg.animation ? ["sendAnimation", "animation", msg.animation.file_id] : msg.document ? ["sendDocument", "document", msg.document.file_id] : null;
  if (media && msg.text === undefined) return telegramCall(token, media[0], { chat_id: msg.chat.id, [media[1]]: media[2], caption: message, caption_entities: entities });
  return telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: message, entities });
}

/** Lets tests wait for the post-reply work. */
export let lastBackground: Promise<void> = Promise.resolve();

export async function receiveConverter(request: Request, body: unknown) {
  const settings = await botSettings();
  const token = settings.telegram_converter_token;
  if (!token || !equal(request.headers.get("x-telegram-bot-api-secret-token") || "", webhookSecret(token))) return Response.json({ detail: "Unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ detail: "Invalid Telegram update" }, { status: 400 });
  const update = parsed.data;
  const msg = update.message || update.channel_post;
  // Anonymous group admins and "post as channel" arrive under a Telegram service bot name; they are real people.
  if (!msg || (msg.from?.is_bot && !(msg as any).sender_chat)) return Response.json({ ok: true });
  const receivedAt = Date.now();
  const text = msg.text ?? msg.caption ?? "";
  const bot = token.split(":")[0];
  const db = await mongo();
  const chats = db.collection("telegram_converter_chats");
  const chatKey = `${bot}:${msg.chat.id}`;
  const connected = connectedLocal.has(chatKey) || !!await chats.findOne({ _id: chatKey as any }, { projection: { _id: 1 } });
  if (connected) connectedLocal.add(chatKey);
  if (/^\/(?:menu|help|start)(?:@\w+)?$/i.test(text.trim()) && msg.chat.type !== "channel") return Response.json({ method: "sendMessage", chat_id: msg.chat.id, text: BOT_HELP });
  if (/^\/tweets(?:@\w+)?(?:\s|$)/i.test(text.trim()) && msg.chat.type !== "channel") {
    const { startTweetCommand } = await import("./tweet-command.server");
    const job = await startTweetCommand(settings, msg, update.update_id, connected, (text) => telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text, link_preview_options: { is_disabled: true } }));
    lastBackground = job.task.catch(() => {});
    return Response.json(job.response);
  }
  const pair = text.match(/^\/(?:start|connect)(?:@\w+)?\s+(\S+)$/);
  if (RADHE.test(text.trim()) || (pair?.[1] && validPairing(pair[1], token))) {
    await chats.updateOne({ _id: chatKey as any }, { $set: { bot, chat_id: String(msg.chat.id), type: msg.chat.type, title: chatName(msg.chat), connected_at: new Date().toISOString() } }, { upsert: true });
    connectedLocal.add(chatKey);
    if (msg.chat.type !== "channel") await telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: "✅ Connected. Radhe Radhe! Send your links or deal text here and I'll reply with your affiliate links." }).catch((e) => console.error("connect reply failed", e.message));
    return Response.json({ ok: true });
  }
  if (PLAIN_START.test(text.trim()) && msg.chat.type !== "channel") {
    await telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: "👋 Send /Radhe to connect this chat, then send your links or deal text. Send /status to check keys and feeds." }).catch((e) => console.error("start reply failed", e.message));
    return Response.json({ ok: true });
  }
  // Unknown chats cannot use the owner's paid affiliate credentials.
  if (!connected) return Response.json({ ok: true });
  if (STATUS.test(text.trim()) && msg.chat.type !== "channel") return Response.json({ method: "sendMessage", chat_id: msg.chat.id, text: await statusReport(settings) });
  const style = text.trim().match(STYLE);
  if (style && msg.chat.type === "private") {
    const want = ({ label: "store", store: "store", name: "store", link: "link", url: "link", https: "link" } as Record<string, string>)[(style[1] || "").toLowerCase()];
    if (want) { await db.collection("settings").updateOne({ id: "main" }, { $set: { converter_label_style: want } }); settingsCache = null; }
    const now = want || settings.converter_label_style || "store";
    return Response.json({ method: "sendMessage", chat_id: msg.chat.id, text: `${want ? "✅ Saved. " : ""}Converted links are shown as ${now === "link" ? "the plain link (https://fkrt.co/...)" : "the store name (@Flipkart)"}.\n\nTo change: /style label  or  /style link` });
  }

  const updates = db.collection("telegram_converter_updates");
  const logs = db.collection("converter_logs");
  const key = `${bot}:${update.update_id}`;
  const messageAt = typeof (msg as any).date === "number" ? (msg as any).date * 1000 : receivedAt;
  const direct = msg.chat.type !== "channel";
  const entities = msg.entities || msg.caption_entities || [];
  const base = () => ({ id: crypto.randomUUID(), chat_id: String(msg.chat.id), chat_type: msg.chat.type, chat_title: chatName(msg.chat), message_at: new Date(messageAt).toISOString(), received_at: new Date(receivedAt).toISOString(),
    replied_at: new Date().toISOString(), deliver_ms: Math.max(0, receivedAt - messageAt), convert_ms: Date.now() - receivedAt, total_ms: Math.max(0, Date.now() - messageAt) });
  const finish = () => updates.updateOne({ _id: key }, { $set: { done: true, finished_at: new Date() } }).catch(() => {});
  let claimed: string[] = [];
  // Step 1: the update lock and the link clean-up run side by side; nothing is changed anywhere yet.
  const lock = takeUpdate(updates, key);
  lock.catch(() => {});
  try {
    const found = findLinks(text, entities);
    const lookups = found.urls.filter((u) => !socialLink(u) && (isShortLink(u) || detectStore(u) === "Other"));
    const [memo, older] = await Promise.all([
      recall(db, lookups.flatMap((u) => [`o:${u}`, `s:${u}`])),
      lookups.some((u) => !local.has(`o:${u}`) && !local.has(`s:${u}`)) ? logs.find({ converted: { $in: lookups }, status: "converted" }, { projection: { _id: 0, converted: 1, cleaned: 1 } }).limit(20).toArray().catch(() => []) : [],
    ]);
    const openStart = Date.now();
    let opened = false;
    const steps: any[] = await Promise.all(found.urls.map((url) => {
      const social = socialLink(url);
      if (social) return social;
      const own = memo.get(`o:${url}`) || (older as any[]).find((r) => r.converted === url)?.cleaned;
      const seen = memo.get(`s:${url}`);
      if (!own && !seen && lookups.includes(url)) opened = true;
      return cleanAffiliate(url, settings, true, own ? async () => ({ cleaned: own }) : undefined, seen);
    }));
    const openMs = opened ? Date.now() - openStart : 0;
    const state = await lock;
    if (state === "done") return Response.json({ ok: true });
    if (state === "busy") return Response.json({ detail: "Processing" }, { status: 503 });

    // Step 2: same product again in the same channel or group? Checked before the converter is asked.
    const repeatMinutes = msg.chat.type === "private" ? 0 : Math.max(0, Number(settings.converter_repeat_minutes ?? 5) || 0);
    const productOf = (i: any) => `${chatKey}:${productKey(i.cleaned)}`;
    const products = steps.filter((i) => !i.error && !i.unsupported && i.store !== "Other");
    const keys = repeatMinutes ? [...new Set(products.map(productOf))] : [];
    const pending = steps.filter((i) => i.pending);
    const [fresh, links] = await Promise.all([keys.length ? claimProducts(db, keys, repeatMinutes * 60_000) : [], recall(db, pending.map((i) => reuseKey(i.cleaned)))]);
    claimed = fresh;
    if (keys.length && !fresh.length) {
      const row = base();
      lastBackground = Promise.all([finish(), logs.insertMany(steps.map((i) => ({ ...row, id: crypto.randomUUID(), service: null, own: !!i.own, store: i.store, original: i.original, cleaned: i.cleaned, converted: null,
        status: "repeat", error: `Same product was already posted in this chat in the last ${repeatMinutes} min`, open_ms: openMs })))]).then(() => {}, (e: any) => console.error("repeat log failed", e?.message));
      // The delete order rides back on this answer: no second trip to Telegram, and Telegram sends no result.
      return Response.json(direct ? { ok: true } : { method: "deleteMessage", chat_id: msg.chat.id, message_id: msg.message_id });
    }

    // Step 3: affiliate links. A listing converted in the last 24 hours reuses its link; the rest go to the converter.
    const service = settings.converter_bot_service;
    const use = service && service !== "auto" ? { ...settings, force_service: service } : settings;
    const askStart = Date.now();
    let asked = false;
    const items: any[] = await Promise.all(steps.map((i) => {
      if (!i.pending) return i;
      const hit = links.get(reuseKey(i.cleaned));
      if (hit?.converted) return { original: i.original, cleaned: i.cleaned, converted: hit.converted, changed: true, error: null, store: i.store, service: hit.service, reused: true };
      asked = true;
      return finishAffiliate(i, use).then((r) => ({ ...r, asked: true }));
    }));
    const serviceMs = asked ? Date.now() - askStart : 0;
    const result = renderConverted(text, entities, found.spans, items, settings);
    const failed = items.filter((i) => i.error);
    const changed = items.some((i) => i.changed && !i.error);
    const own = items.some((i) => i.own || i.keep_clean);
    // A product that was not converted does not count as posted.
    const good = new Set(items.filter((i) => !i.error && (i.changed || i.own || i.keep_clean)).map(productOf));
    const lost = claimed.filter((k) => !good.has(k));
    claimed = claimed.filter((k) => good.has(k));
    void releaseProducts(db, lost);

    // Convert what can be converted and remove every other link; normal text stays exactly as sent.
    let reply: Record<string, unknown> | null = null;
    let telegramMs = 0, posted = false;
    if (!items.length) reply = null;
    else if (changed || own) {
      if (!direct) {
        if (result.message !== text || JSON.stringify(result.entities) !== JSON.stringify(entities)) {
          const editStart = Date.now();
          try {
            await telegramCall(token, msg.text !== undefined ? "editMessageText" : "editMessageCaption", { chat_id: msg.chat.id, message_id: msg.message_id,
              ...(msg.text !== undefined ? { text: result.message, entities: result.entities } : { caption: result.message, caption_entities: result.entities }) });
          } catch (e: any) {
            const why = String(e?.message || "");
            if (/message is not modified/i.test(why)) { /* already shows this text */ }
            else if (GONE.test(why) && Date.now() - messageAt <= POST_AGAIN_MS) {
              await postAgain(token, msg, result.message, result.entities);
              posted = true;
            } else throw e;
          }
          telegramMs = Date.now() - editStart;
        }
      } else {
        if (result.message.length > 4096) throw new Error("Converted message is too long for Telegram; send fewer links in one message");
        reply = { chat_id: msg.chat.id, text: result.message, entities: result.entities, reply_parameters: { message_id: msg.message_id } };
      }
    } else if (!direct) { if (failed.length) console.error("Telegram channel conversion failed; original post kept", failed.map((i) => i.error)); }
    else if (failed.length) reply = { chat_id: msg.chat.id, text: `Conversion failed: ${[...new Set(failed.map((i) => i.error))].join("; ").slice(0, 3500)}` };
    else reply = { chat_id: msg.chat.id, text: "No shop link that can be converted was found in this message.", reply_parameters: { message_id: msg.message_id } };
    const row = base();
    // The reply is already sent; saving the deal (slow product lookup) and logging must not delay it.
    lastBackground = (async () => {
      await finish();
      if (!items.length) return;
      if (direct && changed && failed.length) await telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: `${failed.length} link(s) could not be converted and were removed: ${[...new Set(failed.map((i) => i.error))].join("; ").slice(0, 3000)}` }).catch(() => {});
      await logs.insertMany(items.map((i) => ({ ...row, id: crypto.randomUUID(), service: i.service || null, own: !!i.own, reused: !!i.reused, reposted: posted, store: i.store, original: i.original, cleaned: i.cleaned, converted: i.error ? null : i.converted,
        status: i.error ? "failed" : i.changed ? "converted" : "unchanged", error: i.error || (!i.changed && !i.own ? "Not a convertible shop link; removed" : null), open_ms: openMs, service_ms: i.asked ? serviceMs : 0, telegram_ms: telegramMs })));
      const made = items.filter((i) => i.changed && !i.error && !i.reused);
      await remember(db, [
        ...made.flatMap((i): [string, any, number][] => [[reuseKey(i.cleaned), { converted: i.converted, service: i.service || null }, DAY], [`o:${i.converted}`, i.cleaned, 30 * DAY]]),
        ...steps.filter((i) => i.pending && i.cleaned !== i.original && lookups.includes(i.original) && !memo.has(`s:${i.original}`) && !isShortLink(i.cleaned) && !isDealSite(i.cleaned)).map((i): [string, any, number] => [`s:${i.original}`, i.cleaned, DAY]),
      ]).catch((e: any) => console.error("link memory failed", e?.message));
      await chats.updateOne({ _id: chatKey as any, title: { $ne: chatName(msg.chat) } }, { $set: { title: chatName(msg.chat) } }).catch(() => {});
      if (!indexed) {
        indexed = true;
        await logs.createIndex({ converted: 1 }).catch(() => {});
        await db.collection("converter_memory").createIndex({ exp: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
        await db.collection("converter_products").deleteMany({ at: { $lt: Date.now() - 8 * DAY } }).catch(() => {});
      }
      for (const i of items) await alertIfKeyFailed(i.error);
      for (const item of items) {
        if (item.error || !item.changed || item.reused) continue;
        await publishConversion({ original: item.original, cleaned: item.cleaned, converted: item.converted, error: null, text, settings, source: "Telegram converter" });
      }
    })().catch((e) => console.error("converter background work failed", e?.message));
    // Answering inside the webhook response saves a separate round trip to Telegram.
    return Response.json(reply ? { method: "sendMessage", ...reply } : { ok: true });
  } catch (error) {
    await releaseProducts(db, claimed);
    const detail = String((error as Error)?.message || error).slice(0, 300);
    // Telegram refusing this exact post (too long, not changed) will never succeed on a retry; retrying only blocks the posts behind it.
    if (/^Telegram \(4(?!29)\d\d\)|Send up to 10 links|too long for Telegram/.test(detail)) {
      lastBackground = Promise.all([finish(), logs.insertOne({ ...base(), service: null, store: "Other", original: text.match(/https?:\/\/\S+/)?.[0] || text.slice(0, 200), cleaned: null, converted: null, status: "failed", error: `Post left as it was: ${detail}` })]).then(() => {}, () => {});
      return Response.json(msg.chat.type === "channel" ? { ok: true } : { method: "sendMessage", chat_id: msg.chat.id, text: `Conversion failed: ${detail}` });
    }
    if (await lock.catch(() => null) === "go") await updates.updateOne({ _id: key }, { $set: { locked_until: 0 } });
    throw error;
  }
}
