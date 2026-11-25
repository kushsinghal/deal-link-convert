// Private Channel Reader: one always-on Telegram user connection reads the source channels and the bot posts a new post.
// Source posts are never forwarded or copied; only their text, links and (optionally) photo are read.
import crypto from "node:crypto";
import { mongo } from "./db.server";
import { getSettings } from "./core.server";
import { cleanAffiliate, finishAffiliate, socialLink } from "./affiliate.server";
import { productKey, detectStore, isShortLink, converterChain } from "./engine.server";
import { buildPost, messageLinks, parseDeal, priceNumber } from "./private-reader-format";

const POLL_MS = 8000;
const MAX_AGE_MS = 3 * 60_000;
const DAY = 86400_000;
// A source deleting its post within this time deletes our copies too; later deletions only add "Deal expired".
const DELETE_WINDOW_MS = 2 * 60_000;
// Source posts deleted before our copy was saved (key -> time), checked again once the copy is posted.
const deletedEarly = new Map<string, number>();

type Source = { name: string; id: string; entity: any; lastId: number; retry?: Map<number, number> };
const state = {
  enabled: false, connected: false, user: null as string | null, started_at: null as string | null,
  sources: [] as { name: string; ok: boolean; joined?: boolean; error?: string }[],
  last_read: null as any, last_sent: null as any, last_error: null as any, prepared: null as any,
};
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;
/** Last read / sent / error and timings are saved, so they are still shown after a restart. */
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const { last_read, last_sent, last_error, prepared } = state;
    void mongo().then((db) => db.collection("reader_state").updateOne({ _id: "main" as any }, { $set: { last_read, last_sent, last_error, prepared } }, { upsert: true })).catch(() => {});
  }, 1000);
}
async function loadState() {
  if (loaded) return;
  loaded = true;
  const row: any = await (await mongo()).collection("reader_state").findOne({ _id: "main" as any }).catch(() => null);
  for (const k of ["last_read", "last_sent", "last_error", "prepared"] as const) if (row?.[k] && !state[k]) state[k] = row[k];
}
let sources: Source[] = [];
let attached: any = null;
let handler: ((e: any) => void) | null = null;
let poller: ReturnType<typeof setInterval> | null = null;
let starting: Promise<void> | null = null;
let checkedAt = 0;
let attachedAt = 0;
let stopped = false;
const seen = new Map<string, number>();
const destIds = new Map<string, string>();

const fail = (where: string, e: any) => {
  state.last_error = { at: new Date().toISOString(), where, message: String(e?.errorMessage || e?.message || e).slice(0, 300) };
  persist();
  console.error("reader", where, state.last_error.message);
};
const botChat = (chat: string) => `@${chat.replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "")}`;

export async function readerStatus() {
  await loadState();
  return { ...state, sources: state.sources, polling_seconds: POLL_MS / 1000 };
}

/** Called on every API request and cron ping: starts the reader after a restart, stops it when switched off. Cheap. */
export async function ensureReader() {
  if (starting || Date.now() - checkedAt < 15_000) return;
  checkedAt = Date.now();
  await loadState();
  const settings = await getSettings();
  state.enabled = !!settings.reader_enabled;
  if (settings.reader_enabled && !settings.tg_session && state.last_error?.where !== "login") state.last_error = { at: new Date().toISOString(), where: "login", message: "No Telegram login saved on this site. Log in with the spare account in Affiliate Setup → Keys & logins → Sankmo via Telegram." };
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
  stopped = true;
  if (poller) clearInterval(poller);
  poller = null;
  if (attached && handler) try { attached.removeEventHandler(handler, (attached as any)._readerEvent); } catch { /* client already gone */ }
  if (attached?._readerEdit) try { attached.removeEventHandler(attached._readerEditHandler, attached._readerEdit); } catch { /* client already gone */ }
  if (attached?._readerDel) try { attached.removeEventHandler(attached._readerDelHandler, attached._readerDel); } catch { /* client already gone */ }
  attached = null;
  handler = null;
  state.connected = false;
  const bot = await import("./sankmo-bot.server");
  bot.holdClient(false);
}

function startReader() {
  stopped = false;
  starting = (async () => {
    try {
      const bot = await import("./sankmo-bot.server");
      bot.holdClient(true);
      const c = await bot.getClient();
      await attach(c);
      state.started_at = new Date().toISOString();
      poller = setInterval(() => { void tick(); }, POLL_MS);
      void (await mongo()).collection("reader_seen").createIndex({ at: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
      void (await mongo()).collection("reader_posts").createIndex({ at: 1 }, { expireAfterSeconds: 2 * 86400 }).catch(() => {});
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
  const old = new Map(sources.map((s) => [s.name, s]));
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
      const prev = old.get(name);
      sources.push({ name, id: String(entity.id), entity, lastId: prev?.lastId ?? saved ?? latest?.id ?? 0, retry: prev?.retry ?? new Map() });
      state.sources.push({ name, ok: true, joined });
    } catch (e: any) { state.sources.push({ name, ok: false, error: String(e?.errorMessage || e?.message).slice(0, 160) }); }
  }
  await c.invoke(new Api.updates.GetState());
  if (attached && handler) try { attached.removeEventHandler(handler, attached._readerEvent); } catch { /* old client */ }
  const event = new NewMessage({});
  handler = (ev: any) => { const m = ev.message; const id = String(m?.peerId?.channelId ?? ""); const src = sources.find((s) => s.id === id); if (src) void onMessage(src, m, "live"); };
  c.addEventHandler(handler, event);
  c._readerEvent = event;
  const { EditedMessage } = await import("telegram/events/EditedMessage");
  if (attached?._readerEdit) try { attached.removeEventHandler(attached._readerEditHandler, attached._readerEdit); } catch { /* old client */ }
  const editEvent = new EditedMessage({});
  const editHandler = (ev: any) => { const m = ev.message; const src = sources.find((x) => x.id === String(m?.peerId?.channelId ?? "")); if (src && isEnded(m.message)) void markSoldOut(src, m.id).catch((e) => fail("sold-out", e)); };
  c.addEventHandler(editHandler, editEvent);
  c._readerEdit = editEvent;
  c._readerEditHandler = editHandler;
  // A source deleting its post: within 2 min our posts are deleted too, later they get a "Deal expired" line.
  const { DeletedMessage } = await import("telegram/events/DeletedMessage");
  if (attached?._readerDel) try { attached.removeEventHandler(attached._readerDelHandler, attached._readerDel); } catch { /* old client */ }
  const delEvent = new DeletedMessage({});
  const delHandler = (ev: any) => { const src = sources.find((x) => x.id === String(ev.peer?.channelId ?? "")); if (src) for (const id of ev.deletedIds || []) void onSourceDeleted(src, Number(id)).catch((e) => fail("source-deleted", e)); };
  c.addEventHandler(delHandler, delEvent);
  c._readerDel = delEvent;
  c._readerDelHandler = delHandler;
  attached = c;
  attachedAt = Date.now();
  state.connected = true;
  if (state.last_error?.where === "login") state.last_error = null;
}

/** Safety net: Telegram sometimes stops pushing a busy channel to a user account; this picks up anything missed. */
async function tick() {
  try {
    const c = await (await import("./sankmo-bot.server")).getClient();
    // A source that could not be opened at start (network, Telegram hiccup) is tried again every minute.
    if (c !== attached || (state.sources.some((x) => !x.ok) && Date.now() - attachedAt > 60_000)) await attach(c);
    state.connected = !!c.connected;
    for (const src of sources) {
      const msgs = await c.getMessages(src.entity, { limit: 10, minId: src.lastId });
      // Missed posts are handled side by side, like live ones, instead of one after another.
      const missed = [...msgs].reverse();
      if (src.retry?.size) missed.push(...(await c.getMessages(src.entity, { ids: [...src.retry.keys()] })).filter(Boolean));
      await Promise.all(missed.map((m: any) => onMessage(src, m, "poll")));
    }
    void checkDeleted(c).catch((e) => fail("check deleted", e));
    void warmLinks().catch((e) => fail("prepare links", e));
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

type Poster = { prefix: string; resolve(chat: string): Promise<string>; send(chatId: string, text: string, photo: Buffer | null): Promise<any>; edit(chatId: string, messageId: number, text: string, photo: boolean): Promise<unknown>; remove(chatId: string, messageId: number): Promise<unknown>; warm(): void };
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
      const sent: any = await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("Telegram did not confirm the post within 10 s"), { unknown: true })), 10_000))]);
      return { message_id: sent?.id };
    },
    async edit(chatId, messageId, text) {
      return attached.editMessage(accountChats.get(chatId), { message: messageId, text, linkPreview: true });
    },
    async remove(chatId, messageId) {
      return attached.deleteMessages(accountChats.get(chatId), [messageId], { revoke: true });
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
    edit(chatId, messageId, text, photo) {
      return photo ? conv.telegramCall(t, "editMessageCaption", { chat_id: chatId, message_id: messageId, caption: text })
        : conv.telegramCall(t, "editMessageText", { chat_id: chatId, message_id: messageId, text });
    },
    remove(chatId, messageId) {
      return conv.telegramCall(t, "deleteMessage", { chat_id: chatId, message_id: messageId });
    },
    // Opens the connection to the bot server now, so it is ready when the post goes out.
    warm() { void fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel(), () => {}); },
  };
}

let settingsCache: { at: number; v: any } | null = null;
export const forgetReaderSettings = () => { settingsCache = null; };
async function readerSettings() {
  if (!settingsCache || Date.now() - settingsCache.at > 15_000) {
    const v = await getSettings();
    // Sankmo off: the Telegram login is used only to read channels, never to convert through @sankmo_bot.
    settingsCache = { at: Date.now(), v: v.reader_use_sankmo ? v : { ...v, reader_tg_session: v.tg_session, tg_session: null, sankmo_token: "", sankmo_api_url: "" } };
  }
  return settingsCache.v;
}

const UNSUPPORTED = /does not support|INVALID_URL|requires approval|not supported/i;
// A store set to "Keep clean link" counts as done: the clean link is posted as you chose.
const good = (r: any) => !!r && !r.error && (r.changed || r.keep_clean);
const WAIT_MS = 3000;
const inflight = new Map<string, Promise<any>>();

/** Your converter order decides who goes first. If the first has not answered within 0.9 s, the next one is asked too;
 * the first working link wins and the slower request is cancelled. Each waits at most 3 s, then the rest of the order is tried. */
export function hedgedConvert(p: any, settings: any, hedgeMs = 900): Promise<any> {
  // Same product and seller = same job, even if the links differ slightly.
  const key = reuseKeyOf(p.cleaned);
  const running = inflight.get(key);
  if (running) return running.then((r) => ({ ...r, original: p.original, shared: true }));
  const job = race(p, settings, hedgeMs).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

const reuseKeyOf = (u: string) => { try { return productKey(u) + "|" + (new URL(u).searchParams.get("lid") || ""); } catch { return u; } };

function race(p: any, settings: any, hedgeMs: number): Promise<any> {
  const order = converterChain(settings).filter((k) => !(p.store === "Amazon" && k === "sankmo"));
  const base = { ...settings, convert_timeout_ms: WAIT_MS, sankmo_timeout_ms: 8000 };
  const firstC = new AbortController(), secondC = new AbortController();
  const primary = finishAffiliate(p, { ...base, force_service: order[0], cancel_signal: firstC.signal });
  if (order.length < 2) return primary;
  return new Promise<any>((resolve) => {
    let pending = 1, firstResult: any = null, started = false;
    const settle = (r: any, ctl: AbortController) => {
      firstResult ??= r;
      if (good(r)) { clearTimeout(timer); ctl.abort(); return resolve(r); }
      if (--pending === 0) resolve(/cancelled/i.test(firstResult?.error || "") ? r : firstResult);
    };
    const timer = setTimeout(() => {
      started = true; pending++;
      void finishAffiliate(p, { ...base, force_service: order[1], only_service: order[1], cancel_signal: secondC.signal }).then((r) => settle({ ...r, hedged: true }, firstC));
    }, hedgeMs);
    void primary.then((r) => { if (good(r) || started) clearTimeout(timer); settle(r, secondC); });
  });
}

let warmedAt = 0;
/** Every 30 min: products posted in the last 7 days that have no ready link get one in advance, so a repeat posts with 0 s conversion. */
async function warmLinks() {
  if (Date.now() - warmedAt < 30 * 60_000) return;
  warmedAt = Date.now();
  const conv = await import("./telegram-converter.server");
  const db = await mongo();
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const rows = await db.collection("converter_logs").find({ source: "reader", received_at: { $gte: since }, cleaned: { $regex: "flipkart\\." } }, { projection: { _id: 0, cleaned: 1, store: 1 } }).sort({ received_at: -1 }).limit(400).toArray();
  const unique: any[] = [...new Map(rows.map((r: any) => [conv.reuseKey(r.cleaned), r])).values()];
  const have = await conv.recall(db, unique.map((r: any) => conv.reuseKey(r.cleaned)));
  const settings = { ...(await readerSettings()), convert_timeout_ms: 8000 };
  let made = 0;
  for (const r of unique.filter((x: any) => !have.get(conv.reuseKey(x.cleaned))?.converted).slice(0, 30)) {
    // ExtraPe (or EarnKaro) only: background work never queues behind @sankmo_bot.
    const out: any = await finishAffiliate({ original: r.cleaned, cleaned: r.cleaned }, { ...settings, tg_session: null, sankmo_token: "", force_service: "extrape" });
    if (good(out)) { made++; await conv.remember(db, [[conv.reuseKey(r.cleaned), { converted: out.converted, service: out.service || null }, 7 * DAY]]); }
  }
  state.prepared = { at: new Date().toISOString(), products: unique.length, new_links: made };
  persist();
}

export let lastReaderJob: Promise<void> = Promise.resolve();

class Retry extends Error {}

export async function onMessage(src: Source, m: any, via: "live" | "poll") {
  if (!m?.id) return;
  const replyTo = Number(m.replyTo?.replyToMsgId) || 0;
  // A sold-out notice is never posted as a fresh deal; if it answers a source post, our post for it is marked.
  if (isSoldOut(m.message) || (replyTo && isEnded(m.message))) {
    if (m.id > src.lastId) src.lastId = m.id;
    if (replyTo) await markSoldOut(src, replyTo).catch((e) => fail("sold-out", e));
    return;
  }
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
  persist();
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
  let unreachable = false;
  const claimsP = destIdsReady.then((all) => { unreachable = all.some((x) => !x); return all; }).then((all) => Promise.all(all.filter((x): x is { d: any; id: string } => !!x).map(async ({ d, id }) => {
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
    ...made.filter((i) => !i.reused && !i.shared).map((i): [string, any, number] => [conv.reuseKey(i.cleaned), { converted: i.converted, service: i.service || null }, 7 * DAY]),
    ...steps.filter((x) => x.cleaned !== x.original && !memo.has(`s:${x.original}`) && !isShortLink(x.cleaned)).map((x): [string, any, number] => [`s:${x.original}`, x.cleaned, DAY]),
  ]).catch(() => {});
  if (!claims.length && dests.length) throw new Retry("No destination channel could be reached");

  // Each channel gets only the products that are new there and were converted.
  const plan = claims.map((c) => ({ ...c, items: made.filter((i) => c.fresh.includes(keyOf(c.id, i))) }));
  const lost = plan.flatMap((c) => c.fresh.filter((k: string) => !c.items.some((i) => keyOf(c.id, i) === k)));
  const wanted = plan.filter((c) => c.items.length);
  if (!wanted.length) {
    await conv.releaseProducts(db, lost);
    if (unreachable) throw new Retry("A destination channel could not be reached");
    const repeat = claims.length && claims.every((c) => !c.fresh.length);
    await log(repeat
      ? claims.map((c) => ({ chat_id: c.id, chat_title: `Reader: ${src.name} → ${botChat(c.d.chat)}`, store: products[0]?.store, original: products[0]?.original, cleaned: products[0]?.cleaned, converted: null, status: "repeat", error: `Same product was already posted in this channel in the last ${repeatMs / 60_000} min`, service_ms: serviceMs }))
      : items.map((i) => ({ chat_title: `Reader: ${src.name}`, store: i.store, original: i.original, cleaned: i.cleaned, converted: null, status: "failed", error: i.error || (dests.length ? "Not converted; nothing posted" : "No channel takes this price"), service_ms: serviceMs })));
    for (const i of items) await conv.alertIfKeyFailed(i.error);
    if (!repeat && items.some((i) => i.error && !UNSUPPORTED.test(i.error))) throw new Retry(items[0]?.error || "conversion failed");
    return;
  }
  // The source already deleted this post while we were converting: nothing is posted.
  if (deletedEarly.has(`${src.id}:${m.id}`) && receivedAt - messageAt < DELETE_WINDOW_MS) {
    deletedEarly.delete(`${src.id}:${m.id}`);
    await conv.releaseProducts(db, plan.flatMap((c) => c.fresh));
    await log([{ chat_title: `Reader: ${src.name}`, store: products[0]?.store, original: products[0]?.original, cleaned: products[0]?.cleaned, converted: null, status: "deleted", error: "Source deleted its post before we posted it; nothing posted" }]);
    return;
  }
  const photo = settings.reader_photo && m.photo ? await (attached?.downloadMedia(m, {}) as Promise<Buffer>).catch(() => null) : null;
  conv.markReaderPost(made.map((i) => i.converted));
  const sendStart = Date.now();
  const sent = await Promise.all(wanted.map(async (c) => {
    const post = buildPost(deal, c.items.map((i) => ({ store: i.store, url: i.converted })), settings.reader_caption || "");
    try { const r = await poster.send(c.id, post, photo); return { c, ok: true, at: Date.now(), message_id: Number(r?.message_id) || 0, text: post }; } catch (e: any) {
      const msg = String(e?.errorMessage || e?.message || e).slice(0, 300);
      // A timed-out send may still have arrived: it is not repeated, so followers never get the deal twice.
      // Only a clear refusal from Telegram (4xx) is safe to send again; any other failure may have been posted already.
      const refused = /^Telegram \(4\d\d\)/.test(msg) || (Number(e?.code) >= 400 && Number(e?.code) < 500 && !!e?.errorMessage);
      return { c, ok: false, unknown: !refused, error: msg, at: Date.now() };
    }
  }));
  const failedSends = sent.filter((x) => !x.ok);
  const retryable = failedSends.filter((x) => !(x as any).unknown);
  await conv.releaseProducts(db, [...lost, ...retryable.flatMap((x) => x.c.fresh)]);
  const firstOk = sent.find((x) => x.ok);
  if (firstOk) state.last_sent = { at: new Date(firstOk.at).toISOString(), source: src.name, to: sent.filter((x) => x.ok).map((x) => botChat(x.c.d.chat)), total_ms: firstOk.at - messageAt, title: deal.title, processing_ms: firstOk.at - receivedAt, delivery_ms: Math.max(0, receivedAt - messageAt), open_ms: openMs, convert_ms: serviceMs, send_ms: firstOk.at - sendStart, by: settings.reader_post_bot === "account" || !settings.reader_post_bot ? "spare account" : "bot" };
  persist();
  const posted = sent.filter((x: any) => x.ok && x.message_id).map((x: any) => ({ chat: x.c.d.chat, chat_id: x.c.id, message_id: x.message_id, text: x.text, photo: !!photo, keys: x.c.fresh, store: x.c.items[0]?.store, url: x.c.items[0]?.converted }));
  if (posted.length) await db.collection("reader_posts").updateOne({ _id: `${src.id}:${m.id}` as any }, { $set: { at: new Date(), src_at: new Date(messageAt), src_id: src.id, msg_id: m.id, poster: settings.reader_post_bot || "account" }, $push: { posts: { $each: posted } } as any }, { upsert: true }).catch(() => {});
  // Deleted at the source while our post was going out: delete ours now.
  if (posted.length && deletedEarly.has(`${src.id}:${m.id}`)) await onSourceDeleted(src, m.id).catch((e) => fail("source-deleted", e));
  if (failedSends.length) fail("send", failedSends[0]?.error);
  await log(sent.flatMap((x) => x.c.items.map((i: any) => ({
    chat_id: x.c.id, chat_title: `Reader: ${src.name} → ${botChat(x.c.d.chat)}`, service: i.service || null, reused: !!i.reused, store: i.store, original: i.original, cleaned: i.cleaned,
    converted: i.converted, status: x.ok ? "converted" : "failed", error: x.ok ? null : `Post not sent: ${x.error}`, service_ms: i.reused ? 0 : serviceMs, telegram_ms: x.at - sendStart, replied_at: new Date(x.at).toISOString(), total_ms: x.at - messageAt,
  }))));
  // Channels that already got the post count as repeats on the retry, so only the failed channel is tried again.
  if (retryable.length) throw new Retry(retryable[0]?.error || "send failed");
  if (unreachable) throw new Retry("A destination channel could not be reached");
}

const SOLD_OUT = /❌\s*OOS|\bOOS\b|out of stock|sold out|blinked for|lasted \d+\s*(?:sec|min)|deal (?:is )?(?:over|ended|expired)/i;
export const isSoldOut = (text: string) => SOLD_OUT.test(text || "");
// Wider wording, only trusted on an edit or a reply to a deal (a new deal can mention "not available in stores").
const GONE = /not available|unavailable|no longer available|price (?:has )?(?:increased|hiked|went up|is up)|price hike|stock (?:over|finished)/i;
export const isEnded = (text: string) => isSoldOut(text) || GONE.test(text || "");

/** The source marked its deal sold out (edit or reply) or deleted it: our posts get one line ("❌ Sold out" / "❌ Deal expired"), once. */
export async function markSoldOut(src: { id: string; name: string }, messageId: number, label = "❌ Sold out") {
  const settings = await readerSettings();
  if (settings.reader_mark_sold_out === false || stopped) return;
  const db = await mongo();
  const row: any = await db.collection("reader_posts").findOneAndUpdate({ _id: `${src.id}:${messageId}` as any, sold_out: { $ne: true }, removed: { $ne: true } }, { $set: { sold_out: true, sold_out_at: new Date() } });
  const doc = row?.value !== undefined ? row.value : row;
  if (!doc?.posts?.length) return;
  const poster = doc.poster === "account" ? accountPoster(settings) : await botPoster({ ...settings, reader_post_bot: doc.poster });
  const done = await Promise.all(doc.posts.map(async (p: any) => {
    try {
      const id = await poster.resolve(p.chat);
      await poster.edit(id, p.message_id, `${p.text}\n\n${label}`, p.photo);
      return true;
    } catch (e: any) {
      // "message is not modified" means it already says Sold out.
      if (/not modified|MESSAGE_NOT_MODIFIED/i.test(String(e?.errorMessage || e?.message))) return true;
      fail(`sold-out edit ${botChat(p.chat)}`, e);
      return false;
    }
  }));
  // Edits that failed are tried again the next time the source updates; posts already marked are not touched twice.
  const left = doc.posts.filter((_: any, i: number) => !done[i]);
  if (left.length) await db.collection("reader_posts").updateOne({ _id: doc._id }, { $set: { posts: left }, $unset: { sold_out: "" } });
}

/** The source deleted a post: if it was posted under 2 min ago our copies are deleted, otherwise they get "Deal expired". */
export async function onSourceDeleted(src: { id: string; name: string }, messageId: number) {
  if (stopped) return;
  const key = `${src.id}:${messageId}`;
  const db = await mongo();
  const doc: any = await db.collection("reader_posts").findOne({ _id: key as any });
  if (!doc?.posts?.length) {
    // Not posted yet (still converting) or not a deal: remembered for a short while.
    for (const [k, at] of deletedEarly) if (Date.now() - at > 10 * 60_000) deletedEarly.delete(k);
    deletedEarly.set(key, Date.now());
    return;
  }
  deletedEarly.delete(key);
  if (doc.removed) return;
  const age = Date.now() - new Date(doc.src_at || doc.at).getTime();
  if (age > DELETE_WINDOW_MS) return markSoldOut(src, messageId, "❌ Deal expired");
  const row: any = await db.collection("reader_posts").findOneAndUpdate({ _id: key as any, removed: { $ne: true } }, { $set: { removed: true, removed_at: new Date() } });
  const claimed = row?.value !== undefined ? row.value : row;
  if (!claimed?.posts?.length) return;
  const settings = await readerSettings();
  const poster = claimed.poster === "account" ? accountPoster(settings) : await botPoster({ ...settings, reader_post_bot: claimed.poster });
  const done = await Promise.all(claimed.posts.map(async (p: any) => {
    try {
      await poster.remove(await poster.resolve(p.chat), p.message_id);
      return true;
    } catch (e: any) {
      // Already gone from our channel counts as deleted.
      if (/message to delete not found|MESSAGE_ID_INVALID/i.test(String(e?.errorMessage || e?.message))) return true;
      fail(`delete ${botChat(p.chat)}`, e);
      return false;
    }
  }));
  const gone = claimed.posts.filter((_: any, i: number) => done[i]);
  // The product may be posted again if the source re-posts it.
  const conv = await import("./telegram-converter.server");
  await conv.releaseProducts(db, gone.flatMap((p: any) => p.keys || []));
  const left = claimed.posts.filter((_: any, i: number) => !done[i]);
  if (left.length) await db.collection("reader_posts").updateOne({ _id: key as any }, { $set: { posts: left }, $unset: { removed: "" } });
  await db.collection("converter_logs").insertMany(gone.map((p: any) => ({ id: crypto.randomUUID(), source: "reader", chat_type: "channel", chat_id: p.chat_id, chat_title: `Reader: ${src.name} → ${botChat(p.chat)}`, store: p.store || "Flipkart", original: p.url || null, cleaned: null, converted: p.url || null, status: "deleted", error: `Source deleted its post ${Math.round(age / 1000)}s after posting; deleted here too`, received_at: new Date().toISOString(), replied_at: new Date().toISOString() }))).catch(() => {});
}

/** Safety net for missed delete notices: posts from the last 2 min are checked against their source every poll. */
async function checkDeleted(c: any) {
  const db = await mongo();
  const rows: any[] = await db.collection("reader_posts").find({ src_at: { $gte: new Date(Date.now() - DELETE_WINDOW_MS) }, removed: { $ne: true } }, { projection: { src_id: 1, msg_id: 1 } }).toArray();
  for (const src of sources) {
    const ids = rows.filter((r) => r.src_id === src.id && r.msg_id).map((r) => Number(r.msg_id));
    if (!ids.length) continue;
    const msgs = await c.getMessages(src.entity, { ids });
    for (const [i, id] of ids.entries()) if (!msgs[i] || msgs[i].className === "MessageEmpty") await onSourceDeleted(src, id);
  }
}

/** Nightly report sent to the owner chat: the day's posts, average time and how many beat 2 seconds. */
export async function dailyReport() {
  const settings = await getSettings();
  if (settings.reader_daily_report === false) return { skipped: true, posts: 0, sent: 0 };
  const db = await mongo();
  const since = new Date(Date.now() - DAY).toISOString();
  const rows: any[] = await db.collection("converter_logs").find({ source: "reader", status: "converted", replied_at: { $gte: since } }, { projection: { _id: 0, message_at: 1, received_at: 1, total_ms: 1 } }).toArray();
  // One row per source post (first channel), same as the speed panel.
  const posts = [...new Map(rows.map((r) => [`${r.message_at}|${r.received_at}`, r])).values()];
  const times = posts.map((r) => r.total_ms).filter((x: any) => Number.isFinite(x));
  const { notifyOwner } = await import("./telegram-converter.server");
  if (!posts.length) { const sent = await notifyOwner("📊 Daily speed report (last 24h)\n\nNo deals were posted today."); return { posts: 0, sent }; }
  const s = stat(times)!;
  const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
  const under2 = posts.filter((r) => r.total_ms <= 2000).length;
  const under3 = posts.filter((r) => r.total_ms <= 3000).length;
  const text = [
    "📊 Daily speed report (last 24h)",
    "",
    `📦 Posts sent: ${posts.length}`,
    `⚡ Average time: ${fmt(s.avg)}  •  Median: ${fmt(s.median!)}`,
    `🚀 Beat 2 seconds: ${under2}/${posts.length} (${Math.round((under2 / posts.length) * 100)}%)`,
    `✅ Under 3 seconds: ${under3}/${posts.length}`,
    `🏃 Fastest: ${fmt(Math.min(...times))}  •  🐢 Slowest: ${fmt(Math.max(...times))}`,
  ].join("\n");
  const sent = await notifyOwner(text);
  return { posts: posts.length, under_2s: under2, sent };
}

const stat = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return { avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), median: v[Math.floor(v.length / 2)], p90: v[Math.min(v.length - 1, Math.floor(v.length * 0.9))] };
};
/** Average timings of the last 50 posts the reader sent (one row per post, first channel). */
export async function readerSpeed() {
  const rows: any[] = await (await mongo()).collection("converter_logs").find({ source: "reader", status: "converted" }, { projection: { _id: 0, received_at: 1, message_at: 1, deliver_ms: 1, open_ms: 1, service_ms: 1, telegram_ms: 1, total_ms: 1, reused: 1 } }).sort({ replied_at: -1 }).limit(200).toArray();
  const posts = [...new Map(rows.map((r) => [`${r.message_at}|${r.received_at}`, r])).values()].slice(0, 50);
  const ours = posts.map((r) => (r.total_ms ?? 0) - (r.deliver_ms ?? 0));
  return {
    posts: posts.length,
    delivery: stat(posts.map((r) => r.deliver_ms)), opening: stat(posts.map((r) => r.open_ms)), converting: stat(posts.map((r) => r.service_ms)),
    posting: stat(posts.map((r) => r.telegram_ms)), ours: stat(ours), total: stat(posts.map((r) => r.total_ms)),
    under_2s: posts.filter((r) => r.total_ms <= 2000).length, under_3s: posts.filter((r) => r.total_ms <= 3000).length,
    ready_links: posts.filter((r) => r.reused).length,
  };
}
