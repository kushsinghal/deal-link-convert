import { afterEach, describe, expect, it, vi } from "vitest";
import { receiveConverter, webhookSecret } from "@/server/telegram-converter.server";
import * as converter from "@/server/telegram-converter.server";
import { stripAffiliate, isShortLink, productKey } from "@/server/engine.server";

const token = "123456:" + "a".repeat(30);
const state = vi.hoisted(() => ({ products: new Map<string, number>(), calls: [] as any[], logs: [] as any[], repeat: undefined as number | undefined, deleteOk: true, ekaro: 0, known: {} as Record<string, string>, style: "", service: "" }));
vi.mock("@/server/db.server", () => ({ mongo: async () => ({ collection: (name: string) => ({
  findOne: async (filter: any) => name === "telegram_converter_chats" ? {} : name === "converter_logs" && state.known[filter?.converted] ? { cleaned: state.known[filter.converted] } : null,
  createIndex: async () => ({}),
  insertOne: async () => ({}),
  insertMany: async (rows: any[]) => { if (name === "converter_logs") state.logs.push(...rows); return {}; },
  find: () => ({ toArray: async () => [] }),
  deleteMany: async (filter: any) => { for (const id of filter._id?.$in || []) state.products.delete(id); return {}; },
  updateOne: async (filter: any, patch: any) => {
    if (name === "settings") state.style = patch.$set.converter_label_style;
    if (name !== "converter_products") return { modifiedCount: 1 };
    const at = state.products.get(filter._id);
    if (at !== undefined && !(at <= filter.at.$lte)) throw Object.assign(new Error("dup"), { code: 11000 });
    state.products.set(filter._id, patch.$set.at);
    return { modifiedCount: 1 };
  },
}) }), db: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "main", telegram_converter_token: "123456:" + "a".repeat(30), earnkaro_token: "configured", ...(state.service ? { converter_bot_service: state.service } : {}), ...(state.repeat === undefined ? {} : { converter_repeat_minutes: state.repeat }) }, error: null }) }) }) }) } }));
vi.mock("@/server/core.server", async (original) => ({ ...(await original<any>()), publishConversion: async () => ({}) }));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); state.products.clear(); state.calls = []; state.logs = []; state.repeat = undefined; state.deleteOk = true; state.ekaro = 0; state.known = {}; state.style = ""; state.service = ""; });

let updateId = 1;
async function post(chatId: number, url: string, type = "channel", extra: any = {}) {
  vi.stubEnv("SESSION_SECRET", "test-session-signing-secret-for-telegram");
  vi.stubEnv("EXTRAPE_SESSION_SECRET", "");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u.includes("ekaro-api")) state.ekaro++;
    if (u.includes("ekaro-api")) return Response.json({ success: 1, data: "https://ekaro.in/mine" });
    const method = u.split("/").pop()!;
    state.calls.push({ method, body: JSON.parse(String(init?.body)) });
    if (method === "deleteMessage" && !state.deleteOk) return Response.json({ ok: false, description: "message can't be deleted" }, { status: 400 });
    return Response.json({ ok: true, result: {} });
  }));
  const body = { update_id: updateId++, [type === "channel" ? "channel_post" : "message"]: { message_id: updateId, chat: { id: chatId, type }, text: extra.raw ?? `Deal ${url}`, ...extra.msg } };
  const response = await receiveConverter(new Request("https://x.test", { headers: { "x-telegram-bot-api-secret-token": webhookSecret(token) } }), body);
  await converter.lastBackground;
  const calls = state.calls; state.calls = [];
  return { json: await response.json(), methods: calls.map((c) => c.method) };
}

describe("same product in the same chat", () => {
  const a = "https://www.flipkart.com/x/p/itm1?pid=PID1&affid=other", sameProduct = "https://www.flipkart.com/other-name/p/itm1?pid=PID1&lid=L1";
  it("still drops the repeat 2 minutes later but not in another channel", async () => {
    await post(-1001, a);
    state.products.forEach((_, k) => state.products.set(k, Date.now() - 2 * 60_000));
    expect((await post(-1001, a)).methods).toEqual(["deleteMessage"]);
    expect((await post(-1002, a)).methods).toEqual(["editMessageText"]);
  });
  it("is checked per channel: the channel that already has it drops the repeat, the other accepts it", async () => {
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
    const repeat = await post(-1001, sameProduct);
    expect(repeat.methods).toEqual(["deleteMessage"]);
    expect(state.logs.at(-1).status).toBe("repeat");
    expect((await post(-1002, sameProduct)).methods).toEqual(["editMessageText"]);
    expect((await post(-1001, "https://www.flipkart.com/x/p/itm2?pid=PID2")).methods).toEqual(["editMessageText"]);
  });
  it("converts the repeat as usual when the bot may not delete posts", async () => {
    await post(-1001, a);
    state.deleteOk = false;
    expect((await post(-1001, a)).methods).toEqual(["deleteMessage", "editMessageText"]);
  });
  it("accepts the product again after the chosen time and never checks when turned off", async () => {
    await post(-1001, a);
    state.products.forEach((_, k) => state.products.set(k, Date.now() - 6 * 60_000));
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
    state.repeat = 0;
    expect((await post(-1001, a)).methods).toEqual(["editMessageText"]);
  });
  it("stays silent in a group and always answers in a private chat", async () => {
    expect((await post(-5, a, "group")).json.method).toBe("sendMessage");
    expect((await post(-5, a, "group")).json).toEqual({ ok: true });
    expect((await post(7, a, "private")).json.method).toBe("sendMessage");
    expect((await post(7, a, "private")).json.method).toBe("sendMessage");
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
    for (const copy of [withPid, marketplace, lidOnly]) expect((await post(-1001, copy)).methods).toEqual(["deleteMessage"]);
    expect((await post(-1002, withPid)).methods).toEqual(["editMessageText"]);
  });
  it("does not convert a link the bot already made, and still counts it as that product", async () => {
    state.known["https://ekaro.in/mine"] = withPid;
    const first = await post(-1001, "https://ekaro.in/mine");
    expect(state.ekaro).toBe(0);
    expect(first.methods).toEqual(["editMessageText"]);
    expect(state.logs.at(-1)).toMatchObject({ own: true, status: "unchanged", cleaned: withPid });
    expect((await post(-1001, lidOnly)).methods).toEqual(["deleteMessage"]);
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
  it("switches the link look from the private chat only", async () => {
    expect((await post(7, "", "private", { raw: "/style link" })).json.text).toContain("Saved");
    expect(state.style).toBe("link");
    await post(7, "", "private", { raw: "/style label" });
    expect(state.style).toBe("store");
    state.style = "";
    await post(-5, "", "group", { raw: "/style link" });
    expect(state.style).toBe("");
  });
});
