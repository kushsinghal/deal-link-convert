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
  settingsCache = null;
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

type Poster = { prefix: string; resolve(chat: string): Promise<string>; send(chatId: string, text: string, photo: Buffer | null): Promise<unknown>; warm(): void };
const accountChats = new Map<string, any>();

/** Posting from the spare account uses the connection that is already open: no extra trip to Telegram's bot server. */
function accountPoster(settings: any): Poster {
  return {
    // Same repeat keys as the converter bot uses for that channel, so both share one memory.
    prefix: String(settings.telegram_converter_token || "").split(":")[0] || "acct",
    async resolve(chat) {
      const name = botChat(chat).slice(1);
      let e = accountChats.get(name);
      if (!e) { e = await attached.getEntity(name); accountChats.set(name, e); }
      const id = `-100${e.id}`;
      accountChats.set(id, e);
      return id;
    },
    async send(chatId, text, photo) {
      const entity = accountChats.get(chatId);
      const run = photo
        ? import("telegram/client/uploads").then(({ CustomFile }) => attached.sendFile(entity, { file: new CustomFile("deal.jpg", photo.length, "", photo), caption: text }))
        : attached.sendMessage(entity, { message: text, linkPreview: true });
      return Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error("Telegram did not confirm the post within 10 s")), 10_000))]);
    },
    warm() {},
  };
}

async function botPoster(settings: any): Promise<Poster> {
  let token = settings.telegram_converter_token as string | undefined;
  if (settings.reader_post_bot && settings.reader_post_bot !== "converter") {
    const d = await (await mongo()).collection("destinations").findOne({ id: settings.reader_post_bot }, { projection: { bot_token: 1 } });
    if (d?.bot_token) token = d.bot_token;
  }
  if (!token) throw new Error("No posting bot: pick one in Channel Reader or save the converter bot token");
  const t = token;
  const conv = await import("./telegram-converter.server");
  return {
    prefix: t.split(":")[0] || "bot",
    async resolve(chat) {
      const k = `${t}:${chat}`;
      if (!destIds.has(k)) destIds.set(k, String((await conv.telegramCall(t, "getChat", { chat_id: botChat(chat) })).id));
      return destIds.get(k)!;
    },
    async send(chatId, text, photo) {
      if (!photo) return conv.telegramCall(t, "sendMessage", { chat_id: chatId, text }, 1);
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", text);
      form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "deal.jpg");
      const r = await fetch(`https://api.telegram.org/bot${t}/sendPhoto`, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
      const data: any = await r.json().catch(() => ({}));
      if (!data.ok) throw new Error(`Telegram (${r.status}): ${data.description || "sendPhoto failed"}`);
      return data.result;
    },
    // Opens the connection to the bot server now, so it is ready when the post goes out.
    warm() { void fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel(), () => {}); },
  };
}

let settingsCache: { at: number; v: any } | null = null;
export const forgetReaderSettings = () => { settingsCache = null; };
async function readerSettings() {
  if (!settingsCache || Date.now() - settingsCache.at > 15_000) settingsCache = { at: Date.now(), v: await getSettings() };
  return settingsCache.v;
}

const UNSUPPORTED = /does not support|INVALID_URL|requires approval|not supported/i;
const good = (r: any) => !!r && !r.error && r.changed;
/** ExtraPe first; if it has not answered within 0.9 s, Sankmo is asked too and the first working link wins.
 * Each one still falls back to the rest of the converter order when it fails. */
export function hedgedConvert(p: any, settings: any, hedgeMs = 900): Promise<any> {
  const extrape = finishAffiliate(p, { ...settings, force_service: "extrape" });
  if (!settings.tg_session || p.store === "Amazon" || !settings.extrape_token) return extrape;
  return new Promise((resolve) => {
    let pending = 1, firstResult: any = null;
    const settle = (r: any) => { firstResult ??= r; if (good(r)) resolve(r); else if (--pending === 0) resolve(firstResult); };
    const timer = setTimeout(() => { pending++; void finishAffiliate(p, { ...settings, force_service: "sankmo" }).then((r) => settle({ ...r, hedged: true })); }, hedgeMs);
    void extrape.then((r) => { if (good(r)) clearTimeout(timer); settle(r); });
  });
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
  const conv = await import("./telegram-converter.server");
  const db = await mongo();
  const [isNew, settings, memo] = await Promise.all([firstTime(`${src.id}:${m.id}`), readerSettings(), conv.recall(db, urls.map((u) => `s:${u}`))]);
  if (!isNew) return;
  const deal = parseDeal(text);
  state.last_read = { at: new Date(receivedAt).toISOString(), source: src.name, message_id: m.id, via, title: deal.title, delivery_ms: Math.max(0, receivedAt - messageAt) };
  const poster = settings.reader_post_bot === "account" || !settings.reader_post_bot ? accountPoster(settings) : await botPoster(settings);
  poster.warm();
  // Opens the connection to ExtraPe while the short link is being opened, so the conversion starts on a ready connection.
  void fetch("https://www.extrape.com/", { method: "HEAD", signal: AbortSignal.timeout(3000) }).then((r) => r.body?.cancel(), () => {});
  const price = priceNumber(deal.price);
  const dests = (settings.reader_destinations || []).filter((d: any) => !d.min_price || price > d.min_price);
  const destIdsReady = Promise.all(dests.map((d: any) => poster.resolve(d.chat).then((id) => ({ d, id }), (e) => { fail(`channel ${botChat(d.chat)}`, e); return null; })));
  // Optional test mode: the source's short link goes straight to the converter while it is also opened.
  const direct = new Map<string, Promise<any>>();
  if (settings.reader_try_short) for (const u of urls) if (isShortLink(u) && !memo.has(`s:${u}`)) direct.set(u, hedgedConvert({ original: u, cleaned: u }, settings));

  const openStart = Date.now();
  const steps: any[] = await Promise.all(urls.map((u) => cleanAffiliate(u, settings, true, undefined, memo.get(`s:${u}`))));
  const openMs = Date.now() - openStart;
  const products = steps.filter((x) => x.pending && x.store !== "Other");
  const base = { source: "reader", chat_type: "channel", message_at: new Date(messageAt).toISOString(), received_at: new Date(receivedAt).toISOString(), deliver_ms: Math.max(0, receivedAt - messageAt), open_ms: openMs };
  const log = (rows: any[]) => db.collection("converter_logs").insertMany(rows.map((r) => ({ ...base, id: crypto.randomUUID(), replied_at: new Date().toISOString(), total_ms: Date.now() - messageAt, ...r }))).catch(() => {});
  if (!products.length) { await log([{ chat_title: `Reader: ${src.name}`, store: "Other", original: urls[0], cleaned: steps[0]?.cleaned, converted: null, status: "failed", error: "No shop link in this post" }]); return; }

  // The repeat check and the conversion run at the same time; a repeat simply throws the new link away (it stays remembered).
  const repeatMs = Math.max(5, Number(settings.converter_repeat_minutes) || 5) * 60_000;
  const keyOf = (id: string, p: any) => `${poster.prefix}:${id}:${productKey(p.cleaned)}`;
  const askStart = Date.now();
  const claimsP = destIdsReady.then((all) => Promise.all(all.filter((x): x is { d: any; id: string } => !!x).map(async ({ d, id }) => {
    const fresh = await conv.claimProducts(db, [...new Set(products.map((p) => keyOf(id, p)))], repeatMs);
    return { d, id, fresh };
  })));
  const itemsP = conv.recall(db, products.map((p) => conv.reuseKey(p.cleaned))).then((links) => Promise.all(products.map(async (p) => {
    const hit = links.get(conv.reuseKey(p.cleaned));
    if (hit?.converted) return { ...p, converted: hit.converted, changed: true, error: null, service: hit.service, reused: true };
    const early = direct.get(p.original);
    if (early) { const r = await early; if (good(r)) return { ...r, cleaned: p.cleaned, store: p.store, direct: true }; }
    return hedgedConvert(p, settings);
  })));
  const [claims, items] = await Promise.all([claimsP, itemsP]);
  const serviceMs = Date.now() - askStart;
  const made = items.filter(good);
  void conv.remember(db, [
    ...made.filter((i) => !i.reused).map((i): [string, any, number] => [conv.reuseKey(i.cleaned), { converted: i.converted, service: i.service || null }, DAY]),
    ...steps.filter((x) => x.cleaned !== x.original && !memo.has(`s:${x.original}`) && !isShortLink(x.cleaned)).map((x): [string, any, number] => [`s:${x.original}`, x.cleaned, DAY]),
  ]).catch(() => {});
  if (!claims.length && dests.length) throw new Retry("No destination channel could be reached");

  // Each channel gets only the products that are new there and were converted.
  const plan = claims.map((c) => ({ ...c, items: made.filter((i) => c.fresh.includes(keyOf(c.id, i))) }));
  const lost = plan.flatMap((c) => c.fresh.filter((k: string) => !c.items.some((i) => keyOf(c.id, i) === k)));
  const wanted = plan.filter((c) => c.items.length);
  if (!wanted.length) {
    await conv.releaseProducts(db, lost);
    const repeat = claims.length && claims.every((c) => !c.fresh.length);
    await log(repeat
      ? claims.map((c) => ({ chat_id: c.id, chat_title: `Reader: ${src.name} → ${botChat(c.d.chat)}`, store: products[0]?.store, original: products[0]?.original, cleaned: products[0]?.cleaned, converted: null, status: "repeat", error: `Same product was already posted in this channel in the last ${repeatMs / 60_000} min`, service_ms: serviceMs }))
      : items.map((i) => ({ chat_title: `Reader: ${src.name}`, store: i.store, original: i.original, cleaned: i.cleaned, converted: null, status: "failed", error: i.error || (dests.length ? "Not converted; nothing posted" : "No channel takes this price"), service_ms: serviceMs })));
    for (const i of items) await conv.alertIfKeyFailed(i.error);
    if (!repeat && items.some((i) => i.error && !UNSUPPORTED.test(i.error))) throw new Retry(items[0]?.error || "conversion failed");
    return;
  }
  const photo = settings.reader_photo && m.photo ? await (attached?.downloadMedia(m, {}) as Promise<Buffer>).catch(() => null) : null;
  conv.markReaderPost(made.map((i) => i.converted));
  const sendStart = Date.now();
  const sent = await Promise.all(wanted.map(async (c) => {
    const post = buildPost(deal, c.items.map((i) => ({ store: i.store, url: i.converted })), settings.reader_caption || "");
    try { await poster.send(c.id, post, photo); return { c, ok: true, at: Date.now() }; } catch (e: any) { return { c, ok: false, error: String(e?.errorMessage || e?.message || e).slice(0, 300), at: Date.now() }; }
  }));
  const failedSends = sent.filter((x) => !x.ok);
  await conv.releaseProducts(db, [...lost, ...failedSends.flatMap((x) => x.c.fresh)]);
  const firstOk = sent.find((x) => x.ok);
  if (firstOk) state.last_sent = { at: new Date(firstOk.at).toISOString(), source: src.name, to: sent.filter((x) => x.ok).map((x) => botChat(x.c.d.chat)), total_ms: firstOk.at - messageAt, title: deal.title, by: poster.prefix === "acct" || settings.reader_post_bot === "account" ? "spare account" : "bot" };
  if (failedSends.length) fail("send", failedSends[0]?.error);
  await log(sent.flatMap((x) => x.c.items.map((i: any) => ({
    chat_id: x.c.id, chat_title: `Reader: ${src.name} → ${botChat(x.c.d.chat)}`, service: i.service || null, reused: !!i.reused, store: i.store, original: i.original, cleaned: i.cleaned,
    converted: i.converted, status: x.ok ? "converted" : "failed", error: x.ok ? null : `Post not sent: ${x.error}`, service_ms: i.reused ? 0 : serviceMs, telegram_ms: x.at - sendStart, replied_at: new Date(x.at).toISOString(), total_ms: x.at - messageAt,
  }))));
  // Channels that already got the post count as repeats on the retry, so only the failed channel is tried again.
  if (failedSends.length) throw new Retry(failedSends[0]?.error || "send failed");
}
