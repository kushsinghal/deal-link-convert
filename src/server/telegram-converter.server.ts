import crypto, { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { mongo } from "./db.server";
import { getSettings, publishConversion } from "./core.server";
import { convertAffiliateText } from "./affiliate.server";
import { productKey } from "./engine.server";
import { BOT_COMMANDS, BOT_HELP } from "../lib/bot-commands";

const tokenSchema = z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/, "Enter the bot token from BotFather");
const entity = z.object({ type: z.string().max(40), offset: z.number().int().min(0), length: z.number().int().min(0), url: z.string().url().max(4096).optional() }).passthrough();
const messageSchema = z.object({ message_id: z.number().int(), chat: z.object({ id: z.number().int(), type: z.enum(["private", "group", "supergroup", "channel"]) }), from: z.object({ is_bot: z.boolean().optional() }).passthrough().optional(), text: z.string().max(4096).optional(), caption: z.string().max(1024).optional(), entities: z.array(entity).max(100).optional(), caption_entities: z.array(entity).max(100).optional() }).passthrough();
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

export async function telegramCall(token: string, method: string, body: Record<string, unknown>) {
  tokenSchema.parse(token);
  let response: Response | undefined;
  for (let attempt = 0; !response; attempt++) {
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    } catch (e: any) {
      console.error("Telegram network error", method, attempt, e?.cause?.code || e?.name || "unknown");
      if (attempt >= 2) throw new Error("Telegram could not be reached. Try again.");
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
  await syncBotMenu();
  await notifyOwner("✅ Connected. The converter bot is running — send your links here.");
  return { username: bot.username, pairing_code: pairingCode(token), webhook_url: `${url.origin}/api/public/telegram/converter` };
}

export async function converterStatus() {
  const settings = await getSettings();
  if (!settings.telegram_converter_token) return { connected: false, chats: [] };
  const info = await telegramCall(settings.telegram_converter_token, "getWebhookInfo", {});
  const db = await mongo();
  const chats = await db.collection("telegram_converter_chats").find({ bot: settings.telegram_converter_token.split(":")[0] }, { projection: { _id: 0, chat_id: 1, type: 1 } }).toArray();
  return { connected: !!info.url, webhook_url: info.url, pending: info.pending_update_count, error: info.last_error_message || null, chats, pairing_code: pairingCode(settings.telegram_converter_token) };
}

export async function disconnectConverter() {
  const settings = await getSettings();
  if (settings.telegram_converter_token) {
    await notifyOwner("⛔ Disconnected: the converter bot was turned off from Control Room. Links sent now will not be converted. Press Connect bot to start again.");
    await telegramCall(settings.telegram_converter_token, "deleteWebhook", {});
  }
  const db = await mongo();
  await db.collection("settings").updateOne({ id: "main" }, { $set: { telegram_converter_connected: false } });
  return { connected: false };
}

/** Marks products as posted in one chat; returns the keys that were not posted there inside the window. */
async function claimProducts(db: any, keys: string[], windowMs: number) {
  const col = db.collection("converter_products");
  const at = Date.now();
  const got = await Promise.all(keys.map(async (key) => {
    try { await col.updateOne({ _id: key, at: { $lte: at - windowMs } }, { $set: { at } }, { upsert: true }); return key; } catch (e: any) {
      if (e?.code === 11000) return null;
      throw e;
    }
  }));
  return got.filter((k): k is string => !!k);
}

/** Lets tests wait for the post-reply work. */
export let lastBackground: Promise<void> = Promise.resolve();

export async function receiveConverter(request: Request, body: unknown) {
  const settings = await getSettings();
  const token = settings.telegram_converter_token;
  if (!token || !equal(request.headers.get("x-telegram-bot-api-secret-token") || "", webhookSecret(token))) return Response.json({ detail: "Unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ detail: "Invalid Telegram update" }, { status: 400 });
  const update = parsed.data;
  const msg = update.message || update.channel_post;
  if (!msg || msg.from?.is_bot) return Response.json({ ok: true });
  const text = msg.text ?? msg.caption ?? "";
  const bot = token.split(":")[0];
  const db = await mongo();
  const chats = db.collection("telegram_converter_chats");
  const chatKey = `${bot}:${msg.chat.id}`;
  const connected = !!await chats.findOne({ _id: chatKey as any }, { projection: { _id: 1 } });
  if (/^\/(?:menu|help|start)(?:@\w+)?$/i.test(text.trim()) && msg.chat.type !== "channel") return Response.json({ method: "sendMessage", chat_id: msg.chat.id, text: BOT_HELP });
  if (/^\/tweets(?:@\w+)?(?:\s|$)/i.test(text.trim()) && msg.chat.type !== "channel") {
    const { startTweetCommand } = await import("./tweet-command.server");
    const job = await startTweetCommand(settings, msg, update.update_id, connected, (text) => telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text, link_preview_options: { is_disabled: true } }));
    lastBackground = job.task.catch(() => {});
    return Response.json(job.response);
  }
  const pair = text.match(/^\/(?:start|connect)(?:@\w+)?\s+(\S+)$/);
  if (RADHE.test(text.trim()) || (pair?.[1] && validPairing(pair[1], token))) {
    await chats.updateOne({ _id: chatKey as any }, { $set: { bot, chat_id: String(msg.chat.id), type: msg.chat.type, connected_at: new Date().toISOString() } }, { upsert: true });
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
  const updates = db.collection("telegram_converter_updates");
  const key = `${bot}:${update.update_id}`;
  const existing = await updates.findOne({ _id: key });
  if (existing?.done) return Response.json({ ok: true });
  if (existing?.locked_until > Date.now()) return Response.json({ detail: "Processing" }, { status: 503 });
  try {
    if (!existing) await updates.insertOne({ _id: key, locked_until: Date.now() + 300_000 });
    else {
      const claim = await updates.updateOne({ _id: key, done: { $ne: true }, locked_until: { $lte: Date.now() } }, { $set: { locked_until: Date.now() + 300_000 } });
      if (!claim.modifiedCount) return Response.json({ detail: "Processing" }, { status: 503 });
    }
  } catch (error: any) {
    if (error?.code === 11000) return Response.json({ detail: "Processing" }, { status: 503 });
    throw error;
  }
  const receivedAt = Date.now();
  const messageAt = typeof (msg as any).date === "number" ? (msg as any).date * 1000 : receivedAt;
  let claimed: string[] = [];
  try {
    const result = await convertAffiliateText(text, settings, msg.entities || msg.caption_entities || []);
    const failed = result.items.filter((i) => i.error);
    const changed = result.items.some((i) => i.changed && !i.error);
    const own = result.items.some((i: any) => i.own || i.keep_clean);
    const direct = msg.chat.type !== "channel";
    // Same product again in the same channel or group: one database check, done after the links are cleaned.
    const repeatMinutes = msg.chat.type === "private" ? 0 : Math.max(0, Number(settings.converter_repeat_minutes ?? 5) || 0);
    if (repeatMinutes && (changed || own)) {
      const keys = [...new Set(result.items.filter((i: any) => !i.error && i.store !== "Other").map((i: any) => `${chatKey}:${productKey(i.cleaned)}`))];
      claimed = await claimProducts(db, keys, repeatMinutes * 60_000);
      // In a channel the repeat post is deleted; without delete rights it is converted as usual.
      if (keys.length && !claimed.length && (direct || await telegramCall(token, "deleteMessage", { chat_id: msg.chat.id, message_id: msg.message_id }).then(() => true, () => false))) {
        await updates.updateOne({ _id: key }, { $set: { done: true, finished_at: new Date() } });
        const at = new Date().toISOString();
        lastBackground = db.collection("converter_logs").insertMany(result.items.map((i: any) => ({ id: crypto.randomUUID(), chat_id: String(msg.chat.id), chat_type: msg.chat.type, store: i.store, original: i.original, cleaned: i.cleaned, converted: null,
          status: "repeat", error: `Same product was already posted in this chat in the last ${repeatMinutes} min`, message_at: new Date(messageAt).toISOString(), received_at: new Date(receivedAt).toISOString(), replied_at: at, convert_ms: Date.now() - receivedAt, total_ms: Math.max(0, Date.now() - messageAt) }))).then(() => {}, (e: any) => console.error("repeat log failed", e?.message));
        return Response.json({ ok: true });
      }
    }
    // Convert what can be converted and remove every other link; normal text stays exactly as sent.
    let reply: Record<string, unknown> | null = null;
    if (!result.items.length) reply = null;
    else if (changed || own) {
      if (!direct) {
        if (result.message !== text || JSON.stringify(result.entities) !== JSON.stringify(msg.entities || msg.caption_entities || [])) {
          await telegramCall(token, msg.text !== undefined ? "editMessageText" : "editMessageCaption", { chat_id: msg.chat.id, message_id: msg.message_id,
            ...(msg.text !== undefined ? { text: result.message, entities: result.entities } : { caption: result.message, caption_entities: result.entities }) });
        }
      } else {
        if (result.message.length > 4096) throw new Error("Converted message is too long for Telegram; send fewer links in one message");
        reply = { chat_id: msg.chat.id, text: result.message, entities: result.entities, reply_parameters: { message_id: msg.message_id } };
      }
    } else if (!direct) { if (failed.length) console.error("Telegram channel conversion failed; original post kept", failed.map((i) => i.error)); }
    else if (failed.length) reply = { chat_id: msg.chat.id, text: `Conversion failed: ${[...new Set(failed.map((i) => i.error))].join("; ").slice(0, 3500)}` };
    else reply = { chat_id: msg.chat.id, text: "No shop link that can be converted was found in this message.", reply_parameters: { message_id: msg.message_id } };
    const repliedAt = Date.now();
    await updates.updateOne({ _id: key }, { $set: { done: true, finished_at: new Date() } });
    // The reply is already sent; saving the deal (slow product lookup) and logging must not delay it.
    lastBackground = (async () => {
      if (!result.items.length) return;
      if (direct && changed && failed.length) await telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: `${failed.length} link(s) could not be converted and were removed: ${[...new Set(failed.map((i) => i.error))].join("; ").slice(0, 3000)}` }).catch(() => {});
      await db.collection("converter_logs").insertMany(result.items.map((i: any) => ({ id: crypto.randomUUID(), chat_id: String(msg.chat.id), chat_type: msg.chat.type, store: i.store, original: i.original, cleaned: i.cleaned, converted: i.error ? null : i.converted,
        status: i.error ? "failed" : i.changed ? "converted" : "unchanged", error: i.error || (!i.changed && !i.own ? "Not a convertible shop link; removed" : null), message_at: new Date(messageAt).toISOString(), received_at: new Date(receivedAt).toISOString(), replied_at: new Date(repliedAt).toISOString(),
        convert_ms: repliedAt - receivedAt, total_ms: Math.max(0, repliedAt - messageAt) })));
      if (claimed.length) await db.collection("converter_products").deleteMany({ at: { $lt: Date.now() - 8 * 86400_000 } }).catch(() => {});
      for (const i of result.items) await alertIfKeyFailed(i.error);
      for (const item of result.items) {
        if (item.error || !item.changed) continue;
        await publishConversion({ original: item.original, cleaned: item.cleaned, converted: item.converted, error: null, text, settings, source: "Telegram converter" });
      }
    })().catch((e) => console.error("converter background work failed", e?.message));
    // Answering inside the webhook response saves a separate round trip to Telegram.
    return Response.json(reply ? { method: "sendMessage", ...reply } : { ok: true });
  } catch (error) {
    await updates.updateOne({ _id: key }, { $set: { locked_until: 0 } });
    if (claimed.length) await db.collection("converter_products").deleteMany({ _id: { $in: claimed } as any }).catch(() => {});
    throw error;
  }
}