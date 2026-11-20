// T1 tests: /Radhe webhook reply, checkConverterHealth webhook ownership, alertIfKeyFailed key-expiry alerts.
// Uses a real local Mongo but an ISOLATED test database (never the app's dealloot_preview) and a fake bot token.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envFile = Object.fromEntries(readFileSync("/app/backend/.env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
process.env.MONGO_URL = process.env.MONGO_URL || envFile.MONGO_URL;
process.env.DB_NAME = "dealloot_t1_isolated_test";
process.env.SESSION_SECRET = "t1-test-session-secret-not-real";

const TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";
const SITE = "https://site.test";
const EXPECTED = `${SITE}/api/public/telegram/converter`;
const CHAT_ID = "1089828186"; // fake chat in isolated DB; fetch is mocked so nothing reaches Telegram
const calls: { method: string; body: any }[] = [];
let webhookUrl = "";

let mongo: any, conv: any;
beforeAll(async () => {
  ({ mongo } = await import("@/server/db.server"));
  conv = await import("@/server/telegram-converter.server");
  const db = await mongo();
  expect(db.databaseName).toBe("dealloot_t1_isolated_test");
  await db.collection("settings").updateOne({ id: "main" }, { $set: { id: "main", telegram_converter_token: TOKEN, telegram_converter_connected: true, telegram_converter_url: SITE } }, { upsert: true });
  await db.collection("telegram_converter_chats").updateOne({ _id: `123456:${CHAT_ID}` }, { $set: { bot: "123456", chat_id: CHAT_ID, type: "private" } }, { upsert: true });
});
afterAll(async () => {
  const db = await mongo();
  await db.collection("settings").deleteOne({ id: "main" });
  await db.collection("telegram_converter_chats").deleteMany({ bot: "123456" });
  await db.collection("converter_alerts").deleteMany({ _id: { $in: ["extrape-key", "earnkaro-key", "sankmo-key", "x-cookie", "converter-restored", "converter-lost"] } });
  await db.dropDatabase(); // isolated DB created only by this test
});
beforeEach(async () => {
  calls.length = 0;
  webhookUrl = "";
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (!url.startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw new Error("unexpected network call " + url);
    const method = url.split("/").pop()!;
    calls.push({ method, body: JSON.parse(String(init?.body || "{}")) });
    if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: webhookUrl } });
    return Response.json({ ok: true, result: true });
  }));
  await (await mongo()).collection("converter_alerts").deleteMany({ _id: { $in: ["extrape-key", "earnkaro-key", "sankmo-key", "x-cookie", "converter-restored", "converter-lost"] } });
});
const sends = () => calls.filter((c) => c.method === "sendMessage");

describe("/Radhe webhook", () => {
  for (const text of ["/Radhe", "Radhe", "/radhe@xtelgobot", " /RADHE "]) {
    it(`replies Connected for ${JSON.stringify(text)}`, async () => {
      const req = new Request(EXPECTED, { method: "POST", headers: { "x-telegram-bot-api-secret-token": conv.webhookSecret(TOKEN) } });
      const res = await conv.receiveConverter(req, { update_id: 77, message: { message_id: 5, chat: { id: 4242, type: "private" }, text } });
      expect(res.status).toBe(200);
      expect(sends()).toHaveLength(1);
      expect(sends()[0].body.chat_id).toBe(4242);
      expect(sends()[0].body.text).toContain("Connected");
      await (await mongo()).collection("telegram_converter_chats").deleteOne({ _id: "123456:4242" });
    });
  }
  it("rejects wrong secret with 401 and sends nothing", async () => {
    const res = await conv.receiveConverter(new Request(EXPECTED, { headers: { "x-telegram-bot-api-secret-token": "nope" } }), { update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "/Radhe" } });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("plain /start from a new chat is told to send /Radhe", async () => {
    const req = new Request(EXPECTED, { headers: { "x-telegram-bot-api-secret-token": conv.webhookSecret(TOKEN) } });
    const res = await conv.receiveConverter(req, { update_id: 78, message: { message_id: 5, chat: { id: 4343, type: "private" }, text: "/start" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sends()).toHaveLength(1);
    expect(JSON.stringify(sends()[0])).toContain("/Radhe");
  });
});

describe("checkConverterHealth", () => {
  it("re-registers when Telegram has no webhook", async () => {
    webhookUrl = "";
    const r = await conv.checkConverterHealth();
    expect(r).toMatchObject({ checked: true, restored: true });
    const set = calls.find((c) => c.method === "setWebhook");
    expect(set?.body.url).toBe(EXPECTED);
    expect(set?.body.secret_token).toBe(conv.webhookSecret(TOKEN));
  });
  it("does not override a webhook owned by another site URL", async () => {
    webhookUrl = "https://other-copy.example/api/public/telegram/converter";
    const r = await conv.checkConverterHealth();
    expect(r).toEqual({ checked: true, ok: true, other_url: webhookUrl });
    expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
  });
  it("does nothing when the URL matches", async () => {
    webhookUrl = EXPECTED;
    const r = await conv.checkConverterHealth();
    expect(r).toEqual({ checked: true, ok: true });
    expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
  });
});

describe("alertIfKeyFailed", () => {
  const cases: [string, string][] = [
    ["extrape-key", "ExtraPe access token expired or invalid (AUTH). Log in to extrape.com and update the token."],
    ["earnkaro-key", "EarnKaro: Unauthorized"],
    ["earnkaro-key", "EarnKaro: invalid token"],
    ["sankmo-key", "Sankmo: Invalid Token!"],
    ["sankmo-key", "Sankmo bot: AUTH_KEY_UNREGISTERED"],
    ["x-cookie", "X cookie login rejected: log in to the spare X account again and update X_AUTH_TOKEN and X_CT0 (401)"],
  ];
  for (const [key, err] of cases) {
    it(`alerts once for ${err.slice(0, 40)}`, async () => {
      await conv.alertIfKeyFailed(err);
      expect(sends()).toHaveLength(1);
      expect(sends()[0].body.chat_id).toBe(CHAT_ID);
      expect(sends()[0].body.text).toContain(err.slice(0, 30));
      expect(await (await mongo()).collection("converter_alerts").findOne({ _id: key })).toBeTruthy();
      await conv.alertIfKeyFailed(err); // within 6h -> suppressed
      expect(sends()).toHaveLength(1);
    });
  }
  for (const err of ["ExtraPe does not support this link (INVALID_URL). Your ExtraPe key is fine; this store or link type cannot be converted.", "EarnKaro returned no converted link", "Sankmo returned no earning link", "X read failed: timeout", "", null]) {
    it(`no alert for ${JSON.stringify(err)?.slice(0, 40)}`, async () => {
      await conv.alertIfKeyFailed(err as any);
      expect(sends()).toHaveLength(0);
    });
  }
  it("chained error (ExtraPe AUTH; EarnKaro backup Unauthorized) alerts both keys", async () => {
    await conv.alertIfKeyFailed("ExtraPe access token expired or invalid (AUTH). Log in to extrape.com and update the token.; EarnKaro backup: EarnKaro: Unauthorized");
    expect(sends()).toHaveLength(2);
  });
  it("alert re-sends after the 6h window", async () => {
    const db = await mongo();
    await db.collection("converter_alerts").updateOne({ _id: "earnkaro-key" }, { $set: { at: Date.now() - 7 * 3600_000 } }, { upsert: true });
    await conv.alertIfKeyFailed("EarnKaro: Unauthorized");
    expect(sends()).toHaveLength(1);
  });
});
