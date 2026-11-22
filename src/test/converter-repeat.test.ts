import { afterEach, describe, expect, it, vi } from "vitest";
import { receiveConverter, webhookSecret } from "@/server/telegram-converter.server";
import * as converter from "@/server/telegram-converter.server";
import { stripAffiliate, isShortLink, productKey } from "@/server/engine.server";

const token = "123456:" + "a".repeat(30);
const state = vi.hoisted(() => ({ products: new Map<string, number>(), calls: [] as any[], logs: [] as any[], repeat: undefined as number | undefined, fail: {} as Record<string, string>, ekaro: 0, ekaroFail: false,
  opens: 0, known: {} as Record<string, string>, style: "", service: "", settingsReads: 0, chatReads: 0 }));
vi.mock("@/server/db.server", () => ({ mongo: async () => ({ collection: (name: string) => ({
  findOne: async () => { if (name === "telegram_converter_chats") { state.chatReads++; return {}; } return null; },
  createIndex: async () => ({}),
  bulkWrite: async () => ({}),
  insertOne: async (row: any) => { if (name === "converter_logs") state.logs.push(row); return {}; },
  insertMany: async (rows: any[]) => { if (name === "converter_logs") state.logs.push(...rows); return {}; },
  find: (filter: any) => { const rows = name === "converter_logs" ? (filter?.converted?.$in || []).filter((u: string) => state.known[u]).map((u: string) => ({ converted: u, cleaned: state.known[u] })) : []; return { toArray: async () => rows, limit: () => ({ toArray: async () => rows }) }; },
  deleteMany: async (filter: any) => { for (const id of filter._id?.$in || []) state.products.delete(id); return {}; },
  updateOne: async (filter: any, patch: any) => {
    if (name === "settings") state.style = patch.$set.converter_label_style;
    if (name !== "converter_products") return { modifiedCount: 1 };
    const at = state.products.get(filter._id);
    if (at !== undefined && !(at <= filter.at.$lte)) throw Object.assign(new Error("dup"), { code: 11000 });
    state.products.set(filter._id, patch.$set.at);
    return { modifiedCount: 1 };
  },
}) }), db: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { state.settingsReads++; return { data: { id: "main", telegram_converter_token: "123456:" + "a".repeat(30), earnkaro_token: "configured", ...(state.service ? { converter_bot_service: state.service } : {}), ...(state.repeat === undefined ? {} : { converter_repeat_minutes: state.repeat }) }, error: null }; } }) }) }) } }));
vi.mock("@/server/core.server", async (original) => ({ ...(await original<any>()), publishConversion: async () => ({}) }));

afterEach(() => { converter.resetConverterCaches(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); state.products.clear(); state.calls = []; state.logs = []; state.repeat = undefined; state.fail = {}; state.ekaro = 0;
  state.ekaroFail = false; state.opens = 0; state.known = {}; state.style = ""; state.service = ""; state.settingsReads = 0; state.chatReads = 0; });

const SHORT = "https://fkrt.to/abc123", SHORT_TARGET = "https://www.flipkart.com/x/p/itm9?pid=PIDSHORT00000001&lid=LSTPIDSHORT00000001AAAAAA";
let updateId = 1;
async function post(chatId: number, url: string, type = "channel", extra: any = {}) {
  vi.stubEnv("SESSION_SECRET", "test-session-signing-secret-for-telegram");
  vi.stubEnv("EXTRAPE_SESSION_SECRET", "");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u === SHORT) { state.opens++; return new Response(null, { status: 302, headers: { location: SHORT_TARGET } }); }
    if (u.includes("ekaro-api")) {
      state.ekaro++;
      return state.ekaroFail ? Response.json({ success: 0, message: "down" }, { status: 500 }) : Response.json({ success: 1, data: `https://ekaro.in/mine${state.ekaro}` });
    }
    const method = u.split("/").pop()!;
    state.calls.push({ method, body: JSON.parse(String(init?.body)) });
    if (state.fail[method]) return Response.json({ ok: false, description: state.fail[method] }, { status: state.fail[method].includes("Too Many") ? 429 : 400 });
    return Response.json({ ok: true, result: {} });
  }));
  const message_id = updateId + 1000;
  const body = { update_id: updateId++, [type === "channel" ? "channel_post" : "message"]: { message_id, chat: { id: chatId, type }, text: extra.raw ?? `Deal ${url}`, ...extra.msg } };
  const response = await receiveConverter(new Request("https://x.test", { headers: { "x-telegram-bot-api-secret-token": webhookSecret(token) } }), body);
  await converter.lastBackground;
  const calls = state.calls; state.calls = [];
  return { json: await response.json(), methods: calls.map((c) => c.method), calls, message_id };
}
const deleted = (r: any, chat: number) => expect([r.json, r.methods]).toEqual([{ method: "deleteMessage", chat_id: chat, message_id: r.message_id }, []]);

describe("same product in the same chat", () => {
  const a = "https://www.flipkart.com/x/p/itm1?pid=PID1&affid=other", sameProduct = "https://www.flipkart.com/other-name/p/itm1?pid=PID1&lid=L1";
  it("deletes the repeat by answering Telegram, without asking the converter or calling Telegram again", async () => {
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
    expect(state.ekaro).toBe(1);
    deleted(await post(-1001, sameProduct), -1001);
    expect(state.ekaro).toBe(1);
    expect(state.logs.at(-1)).toMatchObject({ status: "repeat", chat_id: "-1001" });
  });
  it("is checked per channel: the other channel still accepts the product, and a new product is accepted", async () => {
    await post(-1001, a);
    deleted(await post(-1001, a), -1001);
    expect((await post(-1002, sameProduct)).methods).toEqual(["editMessageText"]);
    expect((await post(-1001, "https://www.flipkart.com/x/p/itm2?pid=PID2")).methods).toEqual(["editMessageText"]);
  });
  it("still drops the repeat 2 minutes later, and accepts the product again after the chosen time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await post(-1001, a);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    deleted(await post(-1001, a), -1001);
    vi.setSystemTime(Date.now() + 4 * 60_000);
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
  });
  it("still knows the repeat after the server restarts", async () => {
    await post(-1001, a);
    converter.resetConverterCaches();
    deleted(await post(-1001, a), -1001);
  });
  it("stays silent in a group and always answers in a private chat", async () => {
    expect((await post(-5, a, "group")).json.method).toBe("sendMessage");
    expect((await post(-5, a, "group")).json).toEqual({ ok: true });
    expect((await post(7, a, "private")).json.method).toBe("sendMessage");
    expect((await post(7, a, "private")).json.method).toBe("sendMessage");
  });
  it("does not count a product whose conversion failed: the repost is converted, not deleted", async () => {
    state.ekaroFail = true;
    const first = await post(-1001, a);
    expect([first.json, first.methods]).toEqual([{ ok: true }, []]);
    expect(state.logs.at(-1).status).toBe("failed");
    state.ekaroFail = false;
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
  });
});

describe("other people's affiliate details", () => {
  it("removes app-tracker and affiliate ids but keeps what the store needs", () => {
    expect(stripAffiliate("https://www.myntra.com/men-clothing?sort=discount&rf=Price%3A0_120&af_force_deeplink=true&is_retargeting=true&pid=someone_int&c=camp&af_siteid=77&utm_source=x")).toBe("https://www.myntra.com/men-clothing?sort=discount&rf=Price%3A0_120");
    expect(stripAffiliate("https://dl.flipkart.com/dl/a/p/i?pid=PID1&lid=L1&marketplace=FLIPKART&affid=other&affExtParam1=z")).toBe("https://www.flipkart.com/a/p/i?pid=PID1&lid=L1&marketplace=FLIPKART");
    expect(stripAffiliate("https://www.amazon.in/s?k=shoes&tag=other-21&linkCode=ll2&aff_sub=1")).toBe("https://www.amazon.in/s?k=shoes");
    expect(stripAffiliate("https://www.nykaa.com/p/123?productId=123&skuId=9")).toBe("https://www.nykaa.com/p/123?productId=123&skuId=9");
  });
  it("treats unknown shorteners as unresolved links, not as normal store links", () => {
    for (const u of ["https://rb.gy/vaeryx", "https://xyz.in/Ab3dE9", "https://fkrtt.in/en/Zv7nDX", "https://indfs.in/e4e3dc441c"]) expect(isShortLink(u), u).toBe(true);
    for (const u of ["https://www.amazon.in/dp/B0BYLK9PZC", "https://www.boat-lifestyle.com/products/airdopes-141", "https://www.mi.com/in/sale", "https://www.croma.com/phones"]) expect(isShortLink(u), u).toBe(false);
  });
});

describe("what happened on the live channel", () => {
  const lidOnly = "https://www.flipkart.com/titan-watch/p/itm1d9059ddfad35?lid=LSTWATGZYFG5WSGGKHEYGT4TB";
  const withPid = "https://www.flipkart.com/titan-watch/p/itm1d9059ddfad35?pid=WATGZYFG5WSGGKHE&lid=LSTWATGZYFG5WSGGKHEYGT4TB";
  const marketplace = "https://www.flipkart.com/flipkart/p/itm1d9059ddfad35?lid=LSTWATGZYFG5WSGGKHEYGT4TB&marketplace=FLIPKART";
  it("sees the three link shapes of one product as the same product", () => {
    expect(new Set([lidOnly, withPid, marketplace, "https://www.flipkart.com/x/p/itmzzz?pid=WATGZYFG5WSGGKHE"].map(productKey))).toEqual(new Set(["flipkart:WATGZYFG5WSGGKHE"]));
    expect(productKey("https://www.flipkart.com/x/p/itmabc?lid=LSTWATH4FPJZFFXXSFTZZERE3")).toBe("flipkart:WATH4FPJZFFXXSFT");
  });
  it("keeps the first post and deletes the 2nd, 3rd and 4th copy in the same channel", async () => {
    expect((await post(-1001, lidOnly)).methods).toEqual(["editMessageText"]);
    for (const copy of [withPid, marketplace, lidOnly]) deleted(await post(-1001, copy), -1001);
    expect((await post(-1002, withPid)).methods).toEqual(["editMessageText"]);
    expect(state.ekaro).toBe(1);
  });
  it("does not convert a link the bot already made, and still counts it as that product", async () => {
    state.known["https://ekaro.in/older"] = withPid;
    const first = await post(-1001, "https://ekaro.in/older");
    expect(state.ekaro).toBe(0);
    expect(first.methods).toEqual(["editMessageText"]);
    expect(state.logs.at(-1)).toMatchObject({ own: true, status: "unchanged", cleaned: withPid });
    deleted(await post(-1001, lidOnly), -1001);
    expect(state.ekaro).toBe(0);
  });
  it("recognises its own fresh link without reading the history", async () => {
    const made = (await post(7, withPid, "private")).json.entities.at(-1).url;
    expect((await post(-1001, made)).methods).toEqual(["editMessageText"]);
    expect(state.logs.at(-1)).toMatchObject({ own: true, original: made, cleaned: withPid });
    expect(state.ekaro).toBe(1);
  });
  it("records the chat name and the converter that made the link", async () => {
    await post(-1001, withPid, "channel", { msg: { chat: { id: -1001, type: "channel", title: "My Deals" } } });
    expect(state.logs.at(-1)).toMatchObject({ chat_title: "My Deals", service: "EarnKaro", status: "converted" });
  });
  it("answers an anonymous group admin, whose messages arrive under a Telegram bot name", async () => {
    const reply = await post(-5, withPid, "group", { msg: { from: { id: 1087968824, is_bot: true }, sender_chat: { id: -5, type: "group" } } });
    expect(reply.json.method).toBe("sendMessage");
    expect((await post(-6, withPid, "group", { msg: { from: { id: 99, is_bot: true } } })).json).toEqual({ ok: true });
  });
  it("switches the link look from the private chat only, and the next post uses it at once", async () => {
    expect((await post(7, "", "private", { raw: "/style link" })).json.text).toContain("Saved");
    expect(state.style).toBe("link");
    await post(7, "", "private", { raw: "/style label" });
    expect(state.style).toBe("store");
    state.style = "";
    await post(-5, "", "group", { raw: "/style link" });
    expect(state.style).toBe("");
  });
});

describe("links remembered for 24 hours", () => {
  const listing = "https://www.flipkart.com/a/p/itm1?pid=PIDAAAAAAAAAAAA1&lid=LSTPIDAAAAAAAAAAAA1SELLER1";
  const otherSeller = "https://www.flipkart.com/a/p/itm1?pid=PIDAAAAAAAAAAAA1&lid=LSTPIDAAAAAAAAAAAA1SELLER2";
  it("reuses the link of the same listing in another chat instead of asking the converter again", async () => {
    const first = await post(-1001, listing);
    const second = await post(-1002, `${listing}&marketplace=FLIPKART`);
    expect(state.ekaro).toBe(1);
    expect(second.calls[0].body.entities.at(-1).url).toBe(first.calls[0].body.entities.at(-1).url);
    expect(state.logs.at(-1)).toMatchObject({ status: "converted", reused: true, service: "EarnKaro", service_ms: 0 });
  });
  it("asks the converter for another seller's listing of the same product", async () => {
    await post(-1001, listing);
    await post(-1002, otherSeller);
    expect(state.ekaro).toBe(2);
    expect(state.logs.at(-1).reused).toBe(false);
  });
  it("forgets the link after 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await post(-1001, listing);
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    await post(-1002, listing);
    expect(state.ekaro).toBe(2);
  });
  it("forgets remembered links when the converter setup changes, but not for other settings", async () => {
    await post(-1001, listing);
    await converter.settingsChanged(["converter_repeat_minutes"]);
    await post(-1002, listing);
    expect(state.ekaro).toBe(1);
    await converter.settingsChanged(["converter_order"]);
    await post(-1003, listing);
    expect(state.ekaro).toBe(2);
  });
  it("opens a short link once and remembers where it leads", async () => {
    await post(-1001, SHORT);
    await post(-1002, SHORT);
    expect([state.opens, state.ekaro]).toEqual([1, 1]);
    expect(state.logs.at(-1)).toMatchObject({ cleaned: SHORT_TARGET, reused: true, open_ms: 0 });
    deleted(await post(-1002, SHORT_TARGET), -1002);
  });
});

describe("fewer trips and the timing numbers", () => {
  const a = "https://www.flipkart.com/x/p/itm1?pid=PIDT", b = "https://www.flipkart.com/x/p/itm2?pid=PIDU";
  it("reads the settings and the connected chat once, not for every post", async () => {
    await post(-1001, a);
    await post(-1001, b);
    await post(-1001, a);
    expect([state.settingsReads, state.chatReads]).toEqual([1, 1]);
  });
  it("reads the settings again after they are saved", async () => {
    await post(-1001, a);
    await converter.settingsChanged([]);
    await post(-1001, b);
    expect(state.settingsReads).toBe(2);
  });
  it("saves delivery, converter and Telegram time on each entry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const sent = Math.floor(Date.now() / 1000) - 3;
    await post(-1001, a, "channel", { msg: { date: sent } });
    const log = state.logs.at(-1);
    expect(log.deliver_ms).toBeGreaterThanOrEqual(3000);
    expect(log.total_ms).toBeGreaterThanOrEqual(log.deliver_ms);
    for (const k of ["open_ms", "service_ms", "telegram_ms"]) expect(typeof log[k], k).toBe("number");
  });
});

describe("a post that is gone before the bot can edit it", () => {
  const a = "https://www.flipkart.com/x/p/itm1?pid=PIDX";
  it("posts the converted message as a new post when the original was deleted", async () => {
    state.fail['editMessageText'] = "Bad Request: message to edit not found";
    const r = await post(-1001, a);
    expect(r.methods).toEqual(["editMessageText", "sendMessage"]);
    expect(r.calls[1].body).toMatchObject({ chat_id: -1001, text: "Deal @Flipkart" });
    expect(r.calls[1].body.entities.at(-1).url).toBe("https://ekaro.in/mine1");
    expect(state.logs.at(-1)).toMatchObject({ status: "converted", reposted: true });
    state.fail = {};
    deleted(await post(-1001, a), -1001);
  });
  it("posts a deleted photo post again with its photo", async () => {
    state.fail['editMessageCaption'] = "Bad Request: MESSAGE_ID_INVALID";
    const r = await post(-1001, a, "channel", { msg: { text: undefined, caption: `Deal ${a}`, photo: [{ file_id: "small" }, { file_id: "big" }] } });
    expect(r.methods).toEqual(["editMessageCaption", "sendPhoto"]);
    expect(r.calls[1].body).toMatchObject({ photo: "big", caption: "Deal @Flipkart" });
  });
  it("does not post an old deleted post again (older than 10 minutes)", async () => {
    state.fail['editMessageText'] = "Bad Request: message to edit not found";
    const r = await post(-1001, a, "channel", { msg: { date: Math.floor(Date.now() / 1000) - 11 * 60 } });
    expect(r.methods).toEqual(["editMessageText"]);
    expect(state.logs.at(-1)).toMatchObject({ status: "failed" });
    state.fail = {};
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
  });
  it("treats 'not modified' as done", async () => {
    state.fail['editMessageText'] = "Bad Request: message is not modified";
    expect((await post(-1001, a)).json).toEqual({ ok: true });
    expect(state.logs.at(-1).status).toBe("converted");
  });
  it("logs any other refusal and answers ok, so Telegram does not keep re-sending the post", async () => {
    state.fail['editMessageText'] = "Bad Request: chat not found";
    const r = await post(-1001, a);
    expect(r.json).toEqual({ ok: true });
    expect(state.logs.at(-1)).toMatchObject({ status: "failed", chat_id: "-1001" });
    state.fail = {};
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
  });
  it("is still retried when Telegram only asks to slow down", async () => {
    state.fail['editMessageText'] = "Too Many Requests: retry after 3";
    await expect(post(-1001, a)).rejects.toThrow(/429/);
  });
});
