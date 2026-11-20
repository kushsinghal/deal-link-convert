import { mongo } from "./db.server";

const BOT = "sankmo_bot";
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
let client: any = null;
let pending: { client: any; phone: string; hash: string } | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lastSent = 0;

function creds() {
  const apiId = Number(process.env["TELEGRAM_API_ID"]);
  const apiHash = (process.env["TELEGRAM_API_HASH"] || "").trim();
  if (!apiId || !apiHash) throw new Error("Add TELEGRAM_API_ID and TELEGRAM_API_HASH first");
  return { apiId, apiHash };
}

async function settingsCol() { return (await mongo()).collection("settings"); }

async function makeClient(session = "") {
  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions");
  const { apiId, apiHash } = creds();
  const c = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
  c.setLogLevel("error" as any);
  await c.connect();
  return c;
}

async function getClient() {
  if (client?.connected) return client;
  const row = await (await settingsCol()).findOne({ id: "main" }, { projection: { tg_session: 1 } });
  if (!row?.tg_session) throw new Error("Sankmo bot: log in with your Telegram account first");
  client = await makeClient(row.tg_session);
  return client;
}

export async function botStatus() {
  const row = await (await settingsCol()).findOne({ id: "main" }, { projection: { tg_session: 1, tg_user: 1 } });
  let ready = true;
  try { creds(); } catch { ready = false; }
  return { connected: !!row?.tg_session, user: row?.tg_user || null, credentials_ready: ready, code_sent: !!pending };
}

export async function sendLoginCode(phone: string) {
  phone = String(phone || "").replace(/[\s-]/g, "");
  if (!/^\+\d{8,15}$/.test(phone)) throw new Error("Enter your phone with country code, e.g. +919876543210");
  const c = await makeClient();
  const r = await c.sendCode(creds(), phone);
  pending = { client: c, phone, hash: r.phoneCodeHash };
  return { sent: true, via_app: r.isCodeViaApp };
}

export async function verifyLoginCode(code: string, password?: string) {
  if (!pending) throw new Error("Send the login code first");
  const { Api } = await import("telegram");
  const c = pending.client;
  let user: any;
  try {
    const r: any = await c.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.hash, phoneCode: String(code || "").trim() }));
    user = r.user;
  } catch (e: any) {
    if (e?.errorMessage !== "SESSION_PASSWORD_NEEDED") throw new Error(`Telegram login failed: ${e?.errorMessage || e?.message}`);
    if (!password) throw new Error("Your Telegram has two-step verification. Enter your Telegram password too.");
    user = await c.signInWithPassword(creds(), { password: async () => password, onError: async (err: any) => { throw err; } });
  }
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "Telegram user";
  await (await settingsCol()).updateOne({ id: "main" }, { $set: { tg_session: c.session.save(), tg_user: name } }, { upsert: true });
  client = c;
  pending = null;
  return { connected: true, user: name };
}

export async function disconnectBot() {
  try { const { Api } = await import("telegram"); const c = await getClient(); await c.invoke(new Api.auth.LogOut()); await c.disconnect(); } catch { /* session may already be gone */ }
  client = null;
  pending = null;
  await (await settingsCol()).updateOne({ id: "main" }, { $unset: { tg_session: "", tg_user: "" } });
  return { connected: false };
}

function replyLinks(m: any) {
  const fromText = String(m.message || "").match(URL_RE) || [];
  const fromEntities = (m.entities || []).map((e: any) => e.url).filter(Boolean);
  const fromButtons = (m.replyMarkup?.rows || []).flatMap((r: any) => r.buttons.map((b: any) => b.url)).filter(Boolean);
  return [...fromEntities, ...fromText, ...fromButtons].map((u: string) => u.replace(/[.,;!]+$/, ""));
}

async function convertOnce(url: string) {
  const c = await getClient();
  const wait = 1500 - (Date.now() - lastSent);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let sent: any;
  try { sent = await c.sendMessage(BOT, { message: url }); } catch (e: any) {
    if (e?.seconds) throw new Error(`Sankmo bot: Telegram asked to wait ${e.seconds}s (flood protection)`);
    throw new Error(`Sankmo bot: ${e?.errorMessage || e?.message || "send failed"}`);
  }
  lastSent = Date.now();
  let lastText = "";
  for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
    await new Promise((r) => setTimeout(r, 700));
    const msgs = await c.getMessages(BOT, { limit: 5, minId: sent.id });
    for (const m of msgs.filter((x: any) => !x.out).reverse()) {
      lastText = String(m.message || "").slice(0, 160);
      const link = replyLinks(m).find((u) => u !== url && !/t\.me\/|telegram\.me/i.test(u));
      if (link) return link;
    }
  }
  throw new Error(`Sankmo bot: ${lastText || "no reply within 15s"}`);
}

export function convertViaSankmoBot(url: string): Promise<string> {
  const job = queue.then(() => convertOnce(url), () => convertOnce(url));
  queue = job.catch(() => undefined);
  return job;
}
