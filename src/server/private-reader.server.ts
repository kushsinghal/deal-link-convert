// Private Channel Reader: one always-on Telegram user connection reads the source channels and the bot posts a new post.
// Source posts are never forwarded or copied; only their text, links and (optionally) photo are read.
import crypto from "node:crypto";
import { mongo } from "./db.server";
import { getSettings } from "./core.server";
import { cleanAffiliate, finishAffiliate, socialLink } from "./affiliate.server";
import { productKey, detectStore, isShortLink } from "./engine.server";
import { buildPost, messageLinks, parseDeal, priceNumber } from "./private-reader-format";

const POLL_MS = 8000;
const MAX_AGE_MS = 3 * 60_000;
const DAY = 86400_000;

type Source = { name: string; id: string; entity: any; lastId: number; retry?: Map<number, number> };
const state = {
  enabled: false, connected: false, user: null as string | null, started_at: null as string | null,
  sources: [] as { name: string; ok: boolean; joined?: boolean; error?: string }[],
  last_read: null as any, last_sent: null as any, last_error: null as any,
};
let sources: Source[] = [];
let attached: any = null;
let handler: ((e: any) => void) | null = null;
let poller: ReturnType<typeof setInterval> | null = null;
let starting: Promise<void> | null = null;
let checkedAt = 0;
const seen = new Map<string, number>();
const destIds = new Map<string, string>();

const fail = (where: string, e: any) => {
  state.last_error = { at: new Date().toISOString(), where, message: String(e?.errorMessage || e?.message || e).slice(0, 300) };
  console.error("reader", where, state.last_error.message);
};
const botChat = (chat: string) => `@${chat.replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "")}`;

export function readerStatus() {
  return { ...state, sources: state.sources, polling_seconds: POLL_MS / 1000 };
}

/** Called on every API request and cron ping: starts the reader after a restart, stops it when switched off. Cheap. */
export async function ensureReader() {
  if (starting || Date.now() - checkedAt < 15_000) return;
  checkedAt = Date.now();
  const settings = await getSettings();
  state.enabled = !!settings.reader_enabled;
  if (settings.reader_enabled && !poller && settings.tg_session) await startReader();
  else if (!settings.reader_enabled && poller) await stopReader();
}

export async function restartReader() {
  await stopReader();
  checkedAt = 0;
  await ensureReader();
}

export async function stopReader() {
  if (poller) clearInterval(poller);
  poller = null;
  if (attached && handler) try { attached.removeEventHandler(handler, (attached as any)._readerEvent); } catch { /* client already gone */ }
  attached = null;
  handler = null;
  state.connected = false;
  const bot = await import("./sankmo-bot.server");
  bot.holdClient(false);
}

function startReader() {
  starting = (async () => {
    try {
      const bot = await import("./sankmo-bot.server");
      bot.holdClient(true);
      const c = await bot.getClient();
      await attach(c);
      state.started_at = new Date().toISOString();
      poller = setInterval(() => { void tick(); }, POLL_MS);
      void (await mongo()).collection("reader_seen").createIndex({ at: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
    } catch (e) { fail("start", e); state.connected = false; } finally { starting = null; }
  })();
  return starting;
}

async function attach(c: any) {
  const { Api } = await import("telegram");
  const { NewMessage } = await import("telegram/events");
  const settings = await getSettings();
  const me = await c.getMe();
  state.user = [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || "Telegram user";
  const old = new Map(sources.map((s) => [s.name, s.lastId]));
  sources = [];
  state.sources = [];
  for (const name of settings.reader_sources || []) {
    try {
      const entity: any = await c.getEntity(name);
      let joined = !entity.left;
      if (entity.left) { await c.invoke(new Api.channels.JoinChannel({ channel: entity })); joined = true; }
      const [latest] = await c.getMessages(entity, { limit: 1 });
      // After a restart, continue from the last post handled; the age limit stops old posts being replayed.
      const saved = (await (await mongo()).collection("reader_cursor").findOne({ _id: String(entity.id) as any }))?.last_id;
      sources.push({ name, id: String(entity.id), entity, lastId: old.get(name) ?? saved ?? latest?.id ?? 0, retry: new Map() });
      state.sources.push({ name, ok: true, joined });
    } catch (e: any) { state.sources.push({ name, ok: false, error: String(e?.errorMessage || e?.message).slice(0, 160) }); }
  }
  await c.invoke(new Api.updates.GetState());
  if (attached && handler) try { attached.removeEventHandler(handler, attached._readerEvent); } catch { /* old client */ }
  const event = new NewMessage({});
  handler = (ev: any) => { const m = ev.message; const id = String(m?.peerId?.channelId ?? ""); const src = sources.find((s) => s.id === id); if (src) void onMessage(src, m, "live"); };
  c.addEventHandler(handler, event);
  c._readerEvent = event;
  attached = c;
  state.connected = true;
}

/** Safety net: Telegram sometimes stops pushing a busy channel to a user account; this picks up anything missed. */
async function tick() {
  try {
    const c = await (await import("./sankmo-bot.server")).getClient();
    if (c !== attached) await attach(c);
    state.connected = !!c.connected;
    for (const src of sources) {
      const msgs = await c.getMessages(src.entity, { limit: 10, minId: src.lastId });
      for (const m of [...msgs].reverse()) await onMessage(src, m, "poll");
      if (src.retry?.size) for (const m of await c.getMessages(src.entity, { ids: [...src.retry.keys()] })) if (m) await onMessage(src, m, "poll");
    }
  } catch (e) { state.connected = false; fail("poll", e); }
}

async function firstTime(key: string) {
  const now = Date.now();
  if (seen.has(key)) return false;
  if (seen.size > 5000) for (const k of [...seen.keys()].slice(0, 1000)) seen.delete(k);
  seen.set(key, now);
  try { await (await mongo()).collection("reader_seen").insertOne({ _id: key as any, at: new Date() }); return true; } catch (e: any) {
    if (e?.code === 11000) return false;
    throw e;
  }
}

async function postBotToken(settings: any) {
  if (settings.reader_post_bot && settings.reader_post_bot !== "converter") {
    const d = await (await mongo()).collection("destinations").findOne({ id: settings.reader_post_bot }, { projection: { bot_token: 1 } });
    if (d?.bot_token) return d.bot_token as string;
  }
  if (!settings.telegram_converter_token) throw new Error("No posting bot: save the converter bot token in Affiliate Setup → Telegram bot");
  return settings.telegram_converter_token as string;
}

async function destId(token: string, chat: string, call: any) {
  const k = `${token.split(":")[0]}:${chat}`;
  if (!destIds.has(k)) destIds.set(k, String((await call(token, "getChat", { chat_id: botChat(chat) })).id));
  return destIds.get(k)!;
}

async function sendPhoto(token: string, chatId: string, photo: Buffer, caption: string) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "deal.jpg");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
  const data: any = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram (${r.status}): ${data.description || "sendPhoto failed"}`);
  return data.result;
}

export let lastReaderJob: Promise<void> = Promise.resolve();

class Retry extends Error {}

export async function onMessage(src: Source, m: any, via: "live" | "poll") {
  if (!m?.id) return;
  if (m.id > src.lastId) {
    src.lastId = m.id;
    void mongo().then((db) => db.collection("reader_cursor").updateOne({ _id: src.id as any, last_id: { $lt: m.id } }, { $set: { last_id: m.id, name: src.name } }, { upsert: true })).catch(() => {});
  }
  const receivedAt = Date.now();
  const messageAt = (Number(m.date) || 0) * 1000 || receivedAt;
  if (receivedAt - messageAt > MAX_AGE_MS) { src.retry?.delete(m.id); return; }
  const job = handle(src, m, via, receivedAt, messageAt).then(() => { src.retry?.delete(m.id); }, async (e) => {
    fail(`post ${src.name}#${m.id}`, e);
    // A temporary failure (converter, bot, network) is tried again by the next safety poll, at most twice.
    const tries = (src.retry?.get(m.id) || 0) + 1;
    if (tries > 2) { src.retry?.delete(m.id); return; }
    src.retry?.set(m.id, tries);
    seen.delete(`${src.id}:${m.id}`);
    await (await mongo()).collection("reader_seen").deleteOne({ _id: `${src.id}:${m.id}` as any }).catch(() => {});
  });
  lastReaderJob = job;
  await job;
}

async function handle(src: Source, m: any, via: string, receivedAt: number, messageAt: number) {
  const text = String(m.message || "");
  const urls = messageLinks(m).filter((u) => { try { return !socialLink(u) && (detectStore(u) !== "Other" || isShortLink(u)); } catch { return false; } });
  if (!urls.length) return;
  if (!await firstTime(`${src.id}:${m.id}`)) return;
  state.last_read = { at: new Date(receivedAt).toISOString(), source: src.name, message_id: m.id, via, title: parseDeal(text).title, delivery_ms: Math.max(0, receivedAt - messageAt) };
  const conv = await import("./telegram-converter.server");
  const settings = await getSettings();
  const token = await postBotToken(settings);
  const db = await mongo();
  // Opens a connection to Telegram's bot server now, so it is ready when the post goes out.
  const warm = fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel(), () => {});

  const openStart = Date.now();
  const memo = await conv.recall(db, urls.map((u) => `s:${u}`));
  const steps: any[] = await Promise.all(urls.map((u) => cleanAffiliate(u, settings, true, undefined, memo.get(`s:${u}`))));
  const openMs = Date.now() - openStart;
  const products = steps.filter((s) => s.pending && s.store !== "Other");
  const deal = parseDeal(text);
  const base = { source: "reader", chat_type: "channel", message_at: new Date(messageAt).toISOString(), received_at: new Date(receivedAt).toISOString(), deliver_ms: Math.max(0, receivedAt - messageAt), open_ms: openMs };
  if (!products.length) {
    await db.collection("converter_logs").insertOne({ ...base, id: crypto.randomUUID(), chat_title: `Reader: ${src.name}`, store: "Other", original: urls[0], cleaned: steps[0]?.cleaned, converted: null, status: "failed", error: "No shop link in this post", replied_at: new Date().toISOString(), total_ms: Date.now() - messageAt });
    return;
  }

  // Repeat check per destination, by product, shared with the converter bot's memory of that channel.
  const bot = token.split(":")[0];
  const repeatMs = Math.max(5, Number(settings.converter_repeat_minutes) || 5) * 60_000;
  const price = priceNumber(deal.price);
  const dests = (settings.reader_destinations || []).filter((d: any) => !d.min_price || price > d.min_price);
  const askStart = Date.now();
  const [claims, links] = await Promise.all([
    Promise.all(dests.map(async (d: any) => {
      try {
        const id = await destId(token, d.chat, conv.telegramCall);
        const keys = [...new Set(products.map((p) => `${bot}:${id}:${productKey(p.cleaned)}`))];
        return { d, id, keys, fresh: await conv.claimProducts(db, keys, repeatMs) };
      } catch (e) { fail(`channel ${botChat(d.chat)}`, e); return null; }
    })).then((all) => all.filter((x): x is NonNullable<typeof x> => !!x)),
    conv.recall(db, products.map((p) => conv.reuseKey(p.cleaned))),
  ]);
  const wanted = claims.filter((c) => c.fresh.length);
  if (!claims.length && dests.length) throw new Retry("No destination channel could be reached");
  if (!wanted.length) {
    await db.collection("converter_logs").insertMany(claims.map((c) => ({ ...base, id: crypto.randomUUID(), chat_id: c.id, chat_title: `Reader: ${src.name} → ${botChat(c.d.chat)}`, store: products[0]?.store, original: products[0]?.original, cleaned: products[0]?.cleaned, converted: null, status: "repeat", error: `Same product was already posted in this channel in the last ${repeatMs / 60_000} min`, replied_at: new Date().toISOString(), total_ms: Date.now() - messageAt })));
    return;
  }
  const items: any[] = await Promise.all(products.map((p) => {
    const hit = links.get(conv.reuseKey(p.cleaned));
    return hit?.converted ? { ...p, converted: hit.converted, changed: true, error: null, service: hit.service, reused: true } : finishAffiliate(p, settings);
  }));
  const serviceMs = Date.now() - askStart;
  const good = items.filter((i) => !i.error && i.changed);
  const goodKeys = new Set(good.map((i) => productKey(i.cleaned)));
  const releaseLost = () => conv.releaseProducts(db, claims.flatMap((c) => c.fresh.filter((k: string) => !goodKeys.has(k.split(":").slice(2).join(":")))));
  if (!good.length) {
    await releaseLost();
    await db.collection("converter_logs").insertMany(items.map((i) => ({ ...base, id: crypto.randomUUID(), chat_title: `Reader: ${src.name}`, store: i.store, original: i.original, cleaned: i.cleaned, converted: null, status: "failed", error: i.error || "Not converted; nothing posted", service_ms: serviceMs, replied_at: new Date().toISOString(), total_ms: Date.now() - messageAt })));
    for (const i of items) await conv.alertIfKeyFailed(i.error);
    if (items.some((i) => i.error && !/does not support|INVALID_URL|requires approval|not supported/i.test(i.error))) throw new Retry(items[0]?.error || "conversion failed");
    return;
  }
  const post = buildPost(deal, good.map((i) => ({ store: i.store, url: i.converted })), settings.reader_caption || "");
  const photo = settings.reader_photo && m.photo ? await (attached?.downloadMedia(m, {}) as Promise<Buffer>).catch(() => null) : null;
  await warm;
  const sendStart = Date.now();
  const sent = await Promise.all(wanted.map(async (c) => {
    try {
      if (photo) await sendPhoto(token, c.id, photo, post);
      else await conv.telegramCall(token, "sendMessage", { chat_id: c.id, text: post }, 1);
      return { c, ok: true, at: Date.now() };
    } catch (e: any) { return { c, ok: false, error: String(e?.message || e).slice(0, 300), at: Date.now() }; }
  }));
  await releaseLost();
  const failedSends = sent.filter((s) => !s.ok);
  if (failedSends.length) await conv.releaseProducts(db, failedSends.flatMap((s) => s.c.fresh));
  const firstOk = sent.find((s) => s.ok);
  if (firstOk) state.last_sent = { at: new Date(firstOk.at).toISOString(), source: src.name, to: sent.filter((s) => s.ok).map((s) => botChat(s.c.d.chat)), total_ms: firstOk.at - messageAt, title: deal.title };
  if (failedSends.length) fail("send", failedSends[0]?.error);

  await db.collection("converter_logs").insertMany(sent.flatMap((s) => items.map((i) => ({
    ...base, id: crypto.randomUUID(), chat_id: s.c.id, chat_title: `Reader: ${src.name} → ${botChat(s.c.d.chat)}`, service: i.service || null, reused: !!i.reused, store: i.store,
    original: i.original, cleaned: i.cleaned, converted: i.error ? null : i.converted, status: !s.ok || i.error ? "failed" : "converted", error: s.ok ? i.error || null : `Post not sent: ${s.error}`,
    service_ms: i.reused ? 0 : serviceMs, telegram_ms: s.at - sendStart, replied_at: new Date(s.at).toISOString(), total_ms: s.at - messageAt,
  }))));
  await conv.remember(db, [
    ...good.filter((i) => !i.reused).map((i): [string, any, number] => [conv.reuseKey(i.cleaned), { converted: i.converted, service: i.service || null }, DAY]),
    ...steps.filter((s) => s.cleaned !== s.original && !memo.has(`s:${s.original}`) && !isShortLink(s.cleaned)).map((s): [string, any, number] => [`s:${s.original}`, s.cleaned, DAY]),
  ]).catch(() => {});
  // Channels that already got the post count as repeats on the retry, so only the failed channel is tried again.
  if (failedSends.length) throw new Retry(failedSends[0]?.error || "send failed");
}
