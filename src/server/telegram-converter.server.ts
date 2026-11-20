import crypto, { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { mongo } from "./db.server";
import { getSettings, publishConversion } from "./core.server";
import { convertAffiliateText } from "./affiliate.server";

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
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("Telegram could not be reached. Try again.");
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

const RADHE = /^(?:\/radhe(?:@\w+)?|@radhe|radhe)$/i;
const EXTRAPE_KEY_ERROR = /ExtraPe access token expired or invalid|Add your ExtraPe access token/i;
const botId = (token: string) => token.split(":")[0];

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
    const claim = await db.collection("converter_alerts").updateOne({ _id: alertKey as any, at: { $gt: Date.now() - 6 * 3600_000 } }, { $setOnInsert: { at: Date.now() } }, { upsert: false });
    if (claim.matchedCount) return 0;
    await db.collection("converter_alerts").updateOne({ _id: alertKey as any }, { $set: { at: Date.now() } }, { upsert: true });
  }
  let sent = 0;
  for (const chat of await connectedChats(token)) {
    if (chat.type === "channel") continue;
    try { await telegramCall(token, "sendMessage", { chat_id: chat.chat_id, text }); sent++; } catch (e) { console.error("owner alert failed", (e as Error).message); }
  }
  return sent;
}

export async function alertIfExtraPeKeyFailed(error: string | null | undefined) {
  if (!error || !EXTRAPE_KEY_ERROR.test(error)) return;
  await notifyOwner("⚠️ ExtraPe key problem: your links are NOT being converted to your ExtraPe links.\n\nExtraPe says your access token is expired or invalid. Log in to extrape.com, copy the new token and update it in Control Room → Affiliate Setup.\n\nDetail: " + error.slice(0, 300), "extrape-key");
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
  return (await mongo()).collection("converter_logs").find({}, { projection: { _id: 0 } }).sort({ received_at: -1 }).limit(Math.min(limit, 500)).toArray();
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
  const pair = text.match(/^\/(?:start|connect)(?:@\w+)?\s+(\S+)$/);
  if (RADHE.test(text.trim()) || (pair?.[1] && validPairing(pair[1], token))) {
    await chats.updateOne({ _id: chatKey as any }, { $set: { bot, chat_id: String(msg.chat.id), type: msg.chat.type, connected_at: new Date().toISOString() } }, { upsert: true });
    if (msg.chat.type !== "channel") await telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: "✅ Connected. Radhe Radhe! Send your links or deal text here and I'll reply with your affiliate links." });
    return Response.json({ ok: true });
  }
  // Unknown chats cannot use the owner's paid affiliate credentials.
  if (!await chats.findOne({ _id: chatKey })) return Response.json({ ok: true });
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
  try {
    const result = await convertAffiliateText(text, settings, msg.entities || msg.caption_entities || []);
    if (result.items.length) {
      // Do not label a failed conversion as an earning link or modify the channel post on failure.
      if (result.items.some((i) => i.error)) {
        if (msg.chat.type !== "channel") await telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: `Conversion failed: ${result.items.filter((i) => i.error).map((i) => i.error).join("; ").slice(0, 3500)}` });
        else console.error("Telegram channel conversion failed; original post kept", result.items.filter((i) => i.error).map((i) => i.error));
      } else if (msg.chat.type === "channel") {
        if (result.message !== text || JSON.stringify(result.entities) !== JSON.stringify(msg.entities || msg.caption_entities || [])) {
          await telegramCall(token, msg.text !== undefined ? "editMessageText" : "editMessageCaption", { chat_id: msg.chat.id, message_id: msg.message_id,
            ...(msg.text !== undefined ? { text: result.message, entities: result.entities } : { caption: result.message, caption_entities: result.entities }) });
        }
      } else {
        if (result.message.length > 4096) throw new Error("Converted message is too long for Telegram; send fewer links in one message");
        await telegramCall(token, "sendMessage", { chat_id: msg.chat.id, text: result.message, entities: result.entities, reply_parameters: { message_id: msg.message_id } });
      }
    }
    const repliedAt = Date.now();
    await updates.updateOne({ _id: key }, { $set: { done: true, finished_at: new Date() } });
    // The reply is already sent; saving the deal (slow product lookup) and logging must not delay it.
    lastBackground = (async () => {
      if (!result.items.length) return;
      await db.collection("converter_logs").insertMany(result.items.map((i: any) => ({ id: crypto.randomUUID(), chat_id: String(msg.chat.id), chat_type: msg.chat.type, store: i.store, original: i.original, cleaned: i.cleaned, converted: i.error ? null : i.converted,
        status: i.error ? "failed" : i.changed ? "converted" : "unchanged", error: i.error, message_at: new Date(messageAt).toISOString(), received_at: new Date(receivedAt).toISOString(), replied_at: new Date(repliedAt).toISOString(),
        convert_ms: repliedAt - receivedAt, total_ms: Math.max(0, repliedAt - messageAt) })));
      for (const i of result.items) await alertIfExtraPeKeyFailed(i.error);
      for (const item of result.items) {
        if (item.error || !item.changed) continue;
        await publishConversion({ original: item.original, cleaned: item.cleaned, converted: item.converted, error: null, text, settings, source: "Telegram converter" });
      }
    })().catch((e) => console.error("converter background work failed", e?.message));
    return Response.json({ ok: true });
  } catch (error) {
    await updates.updateOne({ _id: key }, { $set: { locked_until: 0 } });
    throw error;
  }
}