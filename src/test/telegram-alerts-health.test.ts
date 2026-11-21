// T1 tests: /Radhe webhook reply, checkConverterHealth webhook ownership, alertIfKeyFailed key-expiry alerts.
// Uses a real local Mongo but an ISOLATED test database (never the app's dealloot_preview) and a fake bot token.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envFile = Object.fromEntries(readFileSync("/app/backend/.env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
process.env["MONGO_URL"] = process.env["MONGO_URL"] || envFile["MONGO_URL"];
const TEST_DB = `dealloot_t1_${randomUUID().replaceAll("-", "")}`;
process.env["DB_NAME"] = TEST_DB;
process.env["SESSION_SECRET"] = "t1-test-session-secret-not-real";
delete process.env["EXTRAPE_SESSION_SECRET"]; // keep settings.extrape_token under test control

const TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";
const SITE = "https://site.test";
const EXPECTED = `${SITE}/api/public/telegram/converter`;
const CHAT_ID = "1089828186"; // fake chat in isolated DB; fetch is mocked so nothing reaches Telegram
const calls: { method: string; body: any }[] = [];
let webhookUrl = "";
let webhookInfo: any = {};
let sendDelayMs = 0;
let extrapeReply: any = { errorCode: "AUTH", errorMessage: "token expired" };
let earnkaroReply: any = { success: 1, data: "https://ekaro.in/enkr2026TEST" };

let mongo: any, conv: any;
beforeAll(async () => {
  ({ mongo } = await import("@/server/db.server"));
  conv = await import("@/server/telegram-converter.server");
  const db = await mongo();
  expect(db.databaseName).toBe(TEST_DB);
  await db.collection("settings").updateOne({ id: "main" }, { $set: { id: "main", telegram_converter_token: TOKEN, telegram_converter_connected: true, telegram_converter_url: SITE } }, { upsert: true });
  await db.collection("telegram_converter_chats").updateOne({ _id: `123456:${CHAT_ID}` }, { $set: { bot: "123456", chat_id: CHAT_ID, type: "private" } }, { upsert: true });
});
afterAll(async () => {
  const db = await mongo();
  await db.collection("settings").deleteOne({ id: "main" });
  await db.collection("telegram_converter_chats").deleteMany({ bot: "123456" });
  await db.collection("converter_alerts").deleteMany({ _id: { $in: ["extrape-key", "earnkaro-key", "sankmo-key", "x-cookie", "converter-restored", "converter-lost"] } });
  // Never drop a database; remove only this suite's known chat fixtures.
  await db.collection("telegram_converter_chats").deleteMany({ _id: { $in: ["123456:4242", "123456:5253"] } });
});
beforeEach(async () => {
  calls.length = 0;
  webhookUrl = "";
  webhookInfo = {};
  sendDelayMs = 0;
  extrapeReply = { errorCode: "AUTH", errorMessage: "token expired" };
  earnkaroReply = { success: 1, data: "https://ekaro.in/enkr2026TEST" };
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith("https://www.extrape.com/")) { calls.push({ method: "extrape", body: {} }); return Response.json(extrapeReply); }
    if (url.startsWith("https://ekaro-api.affiliaters.in/")) { calls.push({ method: "earnkaro", body: {} }); return Response.json(earnkaroReply, { status: earnkaroReply.success === 1 ? 200 : 401 }); }
    if (!url.startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw new Error("unexpected network call " + url);
    const method = url.split("/").pop()!;
    calls.push({ method, body: JSON.parse(String(init?.body || "{}")) });
    if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: webhookUrl, ...webhookInfo } });
    if (method === "sendMessage" && sendDelayMs) await new Promise((r) => setTimeout(r, sendDelayMs));
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
      expect(sends()[0]!.body.chat_id).toBe(4242);
      expect(sends()[0]!.body.text).toContain("Connected");
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
    expect(await res.json()).toMatchObject({ method: "sendMessage", chat_id: 4343, text: expect.stringContaining("/tweets") });
    expect(sends()).toHaveLength(0);
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
      expect(sends()[0]!.body.chat_id).toBe(CHAT_ID);
      expect(sends()[0]!.body.text).toContain(err.slice(0, 30));
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

// Iteration 7: retest of iteration 6 fixes.
const waitFor = async (fn: () => boolean, ms = 2000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); };
const hook = (update_id: number, chat: number, text: string) => conv.receiveConverter(new Request(EXPECTED, { method: "POST", headers: { "x-telegram-bot-api-secret-token": conv.webhookSecret(TOKEN) } }), { update_id, message: { message_id: 9, chat: { id: chat, type: "private" }, text } });

describe("runChain per-converter alert", () => {
  const settings = { extrape_token: "fake-extrape", earnkaro_token: "fake-earnkaro", converter_order: ["extrape", "earnkaro", "sankmo"] };
  it("ExtraPe AUTH fails, EarnKaro backup succeeds -> EarnKaro link returned AND one extrape-key alert", async () => {
    const { convertLink } = await import("@/server/engine.server");
    const out = await convertLink("https://www.flipkart.com/p/itm123?pid=ABC", settings);
    expect(out).toBe("https://ekaro.in/enkr2026TEST");
    expect(calls.map((c) => c.method).slice(0, 2)).toEqual(["extrape", "earnkaro"]);
    await waitFor(() => sends().length > 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(sends()).toHaveLength(1);
    expect(sends()[0]!.body.text).toContain("ExtraPe key problem");
    expect(await (await mongo()).collection("converter_alerts").findOne({ _id: "extrape-key" })).toBeTruthy();
  });
  it("ExtraPe succeeds -> no alert, EarnKaro not called", async () => {
    extrapeReply = { convertedText: "https://fkrt.co/TESTok" };
    const { convertLink } = await import("@/server/engine.server");
    expect(await convertLink("https://www.flipkart.com/p/itm123?pid=ABC", settings)).toBe("https://fkrt.co/TESTok");
    await new Promise((r) => setTimeout(r, 200));
    expect(calls.map((c) => c.method)).toEqual(["extrape"]);
  });
  it("ExtraPe INVALID_URL then EarnKaro ok -> no key alert", async () => {
    extrapeReply = { errorCode: "INVALID_URL" };
    const { convertLink } = await import("@/server/engine.server");
    expect(await convertLink("https://www.flipkart.com/p/itm123?pid=ABC", settings)).toBe("https://ekaro.in/enkr2026TEST");
    await new Promise((r) => setTimeout(r, 200));
    expect(sends()).toHaveLength(0);
  });
  it("both fail with key errors -> both alerts, each once", async () => {
    earnkaroReply = { success: 0, message: "Unauthorized" };
    const { convertLink } = await import("@/server/engine.server");
    await expect(convertLink("https://www.flipkart.com/p/itm123?pid=ABC", settings)).rejects.toThrow(/ExtraPe access token expired.*EarnKaro/);
    await waitFor(() => sends().length >= 2);
    await new Promise((r) => setTimeout(r, 200));
    const texts = sends().map((c) => c.body.text);
    expect(texts.filter((t) => t.includes("ExtraPe key problem"))).toHaveLength(1);
    expect(texts.filter((t) => t.includes("EarnKaro key problem"))).toHaveLength(1);
  });
});

describe("/start and Radhe Radhe", () => {
  it("plain /start does NOT connect the chat", async () => {
    const res = await hook(90, 5151, "/start");
    expect(res.status).toBe(200);
    const reply = await res.json();
    expect(sends()).toHaveLength(0);
    expect(reply.chat_id).toBe(5151);
    expect(reply.text).toContain("/Radhe");
    expect(reply.text).toContain("/menu");
    expect(reply.text).not.toContain("Connected");
    expect(await (await mongo()).collection("telegram_converter_chats").findOne({ _id: "123456:5151" })).toBeNull();
  });
  it("/start@bot also gets the hint", async () => {
    const res = await hook(91, 5152, "/start@xtelgobot");
    expect(sends()).toHaveLength(0);
    expect((await res.json()).text).toContain("/Radhe");
  });
  for (const text of ["Radhe Radhe", "radhe   RADHE"]) {
    it(`${JSON.stringify(text)} connects like /Radhe`, async () => {
      const res = await hook(92, 5253, text);
      expect(res.status).toBe(200);
      expect(sends()).toHaveLength(1);
      expect(sends()[0]!.body.text).toContain("Connected");
      const db = await mongo();
      expect(await db.collection("telegram_converter_chats").findOne({ _id: "123456:5253" })).toBeTruthy();
      await db.collection("telegram_converter_chats").deleteOne({ _id: "123456:5253" });
    });
  }
  it("random text from unknown chat is still ignored", async () => {
    await hook(93, 5354, "hello https://www.flipkart.com/p/itm1");
    expect(calls).toHaveLength(0);
  });
});

describe("checkConverterHealth takes back from a failing copy", () => {
  const other = "https://sleeping-preview.example/api/public/telegram/converter";
  const recent = () => Math.floor(Date.now() / 1000) - 60;
  for (const msg of ["Wrong response from the webhook: 404 Not Found", "Wrong response from the webhook: 502 Bad Gateway", "Connection timed out", "Failed to resolve host: Name or service not known", "Connection refused"]) {
    it(`takes back on recent ${JSON.stringify(msg)}`, async () => {
      webhookUrl = other;
      webhookInfo = { last_error_date: recent(), last_error_message: msg };
      const r = await conv.checkConverterHealth();
      expect(r).toEqual({ checked: true, restored: true });
      const set = calls.find((c) => c.method === "setWebhook");
      expect(set?.body.url).toBe(EXPECTED);
    });
  }
  it("leaves other URL alone when its last error is older than 15 min", async () => {
    webhookUrl = other;
    webhookInfo = { last_error_date: Math.floor(Date.now() / 1000) - 20 * 60, last_error_message: "Wrong response from the webhook: 404 Not Found" };
    expect(await conv.checkConverterHealth()).toEqual({ checked: true, ok: true, other_url: other });
    expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
  });
  it("leaves other URL alone on a recent non-network error (e.g. 400)", async () => {
    webhookUrl = other;
    webhookInfo = { last_error_date: recent(), last_error_message: "Wrong response from the webhook: 400 Bad Request" };
    expect(await conv.checkConverterHealth()).toEqual({ checked: true, ok: true, other_url: other });
    expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
  });
});

describe("notifyOwner atomic dedupe", () => {
  it("two concurrent alerts with the same key send one message", async () => {
    sendDelayMs = 50;
    const results = await Promise.all([conv.notifyOwner("TEST_concurrent A", "x-cookie"), conv.notifyOwner("TEST_concurrent B", "x-cookie")]);
    expect(results.sort()).toEqual([0, 1]);
    expect(sends()).toHaveLength(1);
  });
  it("five concurrent alertIfKeyFailed calls send one message", async () => {
    await Promise.all(Array.from({ length: 5 }, () => conv.alertIfKeyFailed("Sankmo: Invalid Token!")));
    expect(sends()).toHaveLength(1);
  });
  it("alerts without a key are never deduped", async () => {
    await conv.notifyOwner("TEST_no_key 1");
    await conv.notifyOwner("TEST_no_key 2");
    expect(sends()).toHaveLength(2);
  });
});
