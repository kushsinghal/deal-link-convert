import { mongo } from "./db.server";
import { seal, unseal } from "./private-storage.server";
import { takeRateLimit } from "./rate-limit.server";

const BOT = "sankmo_bot";
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
let client: any = null;
let loginBusy = false;
let queue: Promise<unknown> = Promise.resolve();
let lastSent = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 2 * 60e3;

async function closeClient(c: any) { await c?.destroy?.().catch(() => {}); }
let held = false;
/** The channel reader keeps the one Telegram connection open; Sankmo uses the same one. */
export function holdClient(on: boolean) {
  held = on;
  if (on && idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!on) touchClient();
}
function touchClient() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (held) return;
  idleTimer = setTimeout(() => { const c = client; client = null; idleTimer = null; closeClient(c); }, IDLE_MS);
}

const envValue = (k: string) => (process.env[k] || "").trim().replace(/^["']|["']$/g, "").trim();
function creds() {
  const rawId = envValue("TELEGRAM_API_ID"), apiHash = envValue("TELEGRAM_API_HASH");
  const apiId = Number(rawId);
  if (!rawId) throw new Error("TELEGRAM_API_ID is not set on this server.");
  if (!/^\d+$/.test(rawId) || apiId <= 0) throw new Error("TELEGRAM_API_ID is set but is not a plain number.");
  if (!apiHash) throw new Error("TELEGRAM_API_HASH is not set on this server.");
  if (!/^[a-f0-9]{32}$/i.test(apiHash)) throw new Error(`TELEGRAM_API_HASH is set but has ${apiHash.length} characters; it must be exactly 32 letters and digits.`);
  return { apiId, apiHash };
}

async function settingsCol() { return (await mongo()).collection("settings"); }

async function makeClient(session = "") {
  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions");
  const { apiId, apiHash } = creds();
  const c = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 2, requestRetries: 1, floodSleepThreshold: 0, timeout: 10 });
  c.setLogLevel("error" as any);
  await c.connect();
  return c;
}

export async function getClient() {
  touchClient();
  if (client?.connected) return client;
  await closeClient(client);
  const row = await (await settingsCol()).findOne({ id: "main" }, { projection: { tg_session: 1 } });
  if (!row?.tg_session) throw new Error("Sankmo bot: log in with your Telegram account first");
  client = await makeClient(unseal(row.tg_session));
  return client;
}

export async function botStatus() {
  const row = await (await settingsCol()).findOne({ id: "main" }, { projection: { tg_session: 1, tg_user: 1 } });
  let ready = true, problem = "";
  try { creds(); } catch (e: any) { ready = false; problem = e.message; }
  const pending = await loadPending();
  return { connected: !!row?.tg_session, user: row?.tg_user || null, credentials_ready: ready, credentials_problem: problem, code_sent: !!pending, password_required: pending?.password_required || false };
}

async function pendingCol() { return (await mongo()).collection("telegram_login_pending"); }
async function loadPending() {
  const row = await (await pendingCol()).findOne({ _id: "sankmo" as any }, { projection: { _id: 0 } });
  if (!row || row.expires_at <= new Date()) return null;
  return JSON.parse(unseal(row.state));
}
async function savePending(state: any) {
  await (await pendingCol()).updateOne({ _id: "sankmo" as any }, { $set: { state: seal(JSON.stringify(state)), expires_at: new Date(Date.now() + 10 * 60e3) } }, { upsert: true });
}
function loginError(e: any) {
  const code = String(e?.errorMessage || e?.message || "");
  if (/FLOOD/.test(code) || e?.seconds) return new Error(`Telegram asked to wait${e?.seconds ? ` ${e.seconds} seconds` : ""}. Please try later.`);
  if (/PHONE_CODE_EXPIRED|AUTH_RESTART/.test(code)) return new Error("Telegram code expired. Send a new code.");
  if (/PHONE_CODE_INVALID/.test(code)) return new Error("That Telegram code is incorrect. Please try again.");
  if (/PASSWORD_HASH_INVALID/.test(code)) return new Error("That Telegram two-step password is incorrect.");
  if (/PHONE_NUMBER_INVALID/.test(code)) return new Error("Check your phone number and country code.");
  if (/API_ID_INVALID/.test(code)) return new Error("Telegram rejected the API ID/hash. Check the configured API credentials.");
  if (/SEND_CODE_UNAVAILABLE/.test(code)) return new Error("Telegram won't send more codes right now (too many recent code requests). Wait a few hours, then try again.");
  if (/PHONE_NUMBER_BANNED|PHONE_NUMBER_FLOOD/.test(code)) return new Error(`Telegram blocked login codes for this number for now (${code}). Try again later.`);
  console.error("Telegram login failed", code);
  return new Error(`Telegram login could not be completed${code ? ` (Telegram said: ${code.slice(0, 120)})` : ""}. Check your account and try again.`);
}

export async function sendLoginCode(phone: string) {
  phone = String(phone || "").replace(/[\s-]/g, "");
  if (!/^\+\d{8,15}$/.test(phone)) throw new Error("Enter your phone with country code, e.g. +919876543210");
  creds();
  if (loginBusy) throw new Error("A Telegram login request is already running");
  if (!await takeRateLimit("sankmo-send-code", 1, 60e3) || !await takeRateLimit("sankmo-send-code-hour", 3, 3600e3)) throw new Error("Wait before requesting another Telegram code");
  loginBusy = true;
  let c: any;
  try {
    c = await makeClient();
    const r = await c.sendCode(creds(), phone);
    await savePending({ session: c.session.save(), phone, hash: r.phoneCodeHash, password_required: false });
    return { sent: true, via_app: r.isCodeViaApp };
  } catch (e) { throw loginError(e); } finally { await closeClient(c); loginBusy = false; }
}

export async function verifyLoginCode(code: string, password?: string) {
  const pending = await loadPending();
  if (!pending) throw new Error("Send the login code first");
  if (loginBusy) throw new Error("A Telegram login request is already running");
  if (!pending.password_required && !/^\d{4,8}$/.test(String(code || "").trim())) throw new Error("Enter the numeric Telegram login code");
  if (!await takeRateLimit("sankmo-verify", 10, 10 * 60e3)) throw new Error("Too many login attempts. Try later.");
  loginBusy = true;
  const { Api } = await import("telegram");
  let c: any;
  let user: any;
  try {
    c = await makeClient(pending.session);
    if (!pending.password_required) {
      try {
        const r: any = await c.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.hash, phoneCode: String(code).trim() }));
        if (r instanceof Api.auth.AuthorizationSignUpRequired) throw new Error("Sign-up required");
        user = r.user;
      } catch (e: any) {
        if (e?.errorMessage !== "SESSION_PASSWORD_NEEDED") throw e;
        pending.password_required = true;
        pending.session = c.session.save();
        await savePending(pending);
      }
    }
    if (pending.password_required) {
      if (!password) return { connected: false, password_required: true };
      user = await c.signInWithPassword(creds(), { password: async () => password, onError: async (err: any) => { throw err; } });
    }
    if (!user) throw new Error("Authorization not confirmed");
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Telegram user";
    await (await settingsCol()).updateOne({ id: "main" }, { $set: { tg_session: seal(c.session.save()), tg_user: name } }, { upsert: true });
    await (await import("./telegram-converter.server")).settingsChanged(["tg_session"]);
    void import("./private-reader.server").then((r) => r.restartReader()).catch(() => {});
    await (await pendingCol()).updateOne({ _id: "sankmo" as any }, { $unset: { state: "" }, $set: { expires_at: new Date(0) } });
    return { connected: true, user: name };
  } catch (e: any) {
    if (/PHONE_CODE_EXPIRED|AUTH_RESTART/.test(e?.errorMessage || "")) await (await pendingCol()).updateOne({ _id: "sankmo" as any }, { $unset: { state: "" }, $set: { expires_at: new Date(0) } });
    throw loginError(e);
  } finally { await closeClient(c); loginBusy = false; }
}

export async function disconnectBot() {
  await (await import("./private-reader.server")).stopReader().catch(() => {});
  try { const { Api } = await import("telegram"); const c = await getClient(); await c.invoke(new Api.auth.LogOut()); } catch { /* session may already be gone */ }
  await closeClient(client);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  client = null;
  await (await pendingCol()).updateOne({ _id: "sankmo" as any }, { $unset: { state: "" }, $set: { expires_at: new Date(0) } });
  await (await settingsCol()).updateOne({ id: "main" }, { $unset: { tg_session: "", tg_user: "" } });
  await (await import("./telegram-converter.server")).settingsChanged(["tg_session"]);
  return { connected: false };
}

function replyLinks(m: any) {
  const fromText = String(m.message || "").match(URL_RE) || [];
  const fromEntities = (m.entities || []).map((e: any) => e.url).filter(Boolean);
  const fromButtons = (m.replyMarkup?.rows || []).flatMap((r: any) => r.buttons.map((b: any) => b.url)).filter(Boolean);
  return [...fromEntities, ...fromText, ...fromButtons].map((u: string) => u.replace(/[.,;!]+$/, ""));
}

let botUserId: string | null = null;

/** The reply is picked up the moment it arrives (live update); a slower check every 1.5 s is the backup. */
async function convertOnce(url: string) {
  const c = await getClient();
  const { NewMessage } = await import("telegram/events");
  if (!botUserId) botUserId = String((await c.getEntity(BOT)).id);
  const wait = 1500 - (Date.now() - lastSent);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let sentId = 0, lastText = "", done = false;
  const early: any[] = [];
  let resolveLink!: (v: string) => void, rejectLink!: (e: Error) => void;
  const result = new Promise<string>((res, rej) => { resolveLink = res; rejectLink = rej; });
  result.catch(() => {});
  const check = (m: any) => {
    if (done || !m || m.out) return;
    if (!sentId) { early.push(m); return; }
    if (m.id <= sentId) return;
    // A late answer to an earlier link replies to that link's message; it must not be taken for this one.
    const replyTo = m.replyTo?.replyToMsgId;
    if (replyTo && replyTo !== sentId) return;
    lastText = String(m.message || "").slice(0, 160);
    const link = replyLinks(m).find((u) => u !== url && !/t\.me\/|telegram\.me/i.test(u));
    if (link) { done = true; resolveLink(link); }
  };
  const event = new NewMessage({ incoming: true });
  const handler = (e: any) => { if (String(e.message?.peerId?.userId ?? "") === botUserId) check(e.message); };
  c.addEventHandler(handler, event);
  const poll = setInterval(() => { c.getMessages(BOT, { limit: 5, minId: sentId }).then((msgs: any[]) => [...msgs].reverse().forEach(check), () => {}); }, 1500);
  const timer = setTimeout(() => { done = true; rejectLink(new Error(`Sankmo bot: ${lastText || "no reply within 15s"}`)); }, 15000);
  try {
    let sent: any;
    try { sent = await c.sendMessage(BOT, { message: url }); } catch (e: any) {
      if (e?.seconds) throw new Error(`Sankmo bot: Telegram asked to wait ${e.seconds}s (flood protection)`);
      throw new Error(`Sankmo bot: ${e?.errorMessage || e?.message || "send failed"}`);
    }
    lastSent = Date.now();
    sentId = sent.id;
    early.splice(0).forEach(check);
    return await result;
  } finally {
    done = true;
    clearTimeout(timer);
    clearInterval(poll);
    try { c.removeEventHandler(handler, event); } catch { /* client closed */ }
  }
}

export function convertViaSankmoBot(url: string): Promise<string> {
  const job = queue.then(() => convertOnce(url), () => convertOnce(url));
  queue = job.catch(() => undefined);
  return job;
}

export async function testBot() {
  if (!await takeRateLimit("sankmo-test", 3, 60e3)) throw new Error("Wait a minute before testing again");
  const link = await convertViaSankmoBot("https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4");
  return { ok: true, link };
}
