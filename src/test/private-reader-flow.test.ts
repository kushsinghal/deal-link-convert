import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ sent: [] as any[], logs: [] as any[], seen: new Set<string>(), claims: new Map<string, number>(), convertCalls: 0, fail: false, brokenChat: "", settings: {} as any }));
vi.mock("@/server/db.server", () => ({ mongo: async () => ({ collection: (name: string) => ({
  insertOne: async (doc: any) => { if (name === "reader_seen") { if (st.seen.has(doc._id)) throw Object.assign(new Error("dup"), { code: 11000 }); st.seen.add(doc._id); } else st.logs.push(doc); },
  insertMany: async (docs: any[]) => { st.logs.push(...docs); },
  findOne: async () => null, createIndex: async () => {}, updateOne: async () => {},
  deleteOne: async ({ _id }: any) => { st.seen.delete(_id); },
}) }) }));
vi.mock("@/server/core.server", () => ({ getSettings: async () => st.settings }));
vi.mock("@/server/affiliate.server", async (load) => ({ ...(await load<any>()),
  cleanAffiliate: async (u: string) => ({ original: u, cleaned: "https://www.flipkart.com/w/p/itm1?pid=WATHK63SGJGKHYED&lid=LSTWATHK63SGJGKHYEDXXIHUG", store: "Flipkart", pending: true }),
  finishAffiliate: async (i: any) => { st.convertCalls++; return st.fail ? { ...i, error: "ExtraPe down", changed: false } : { ...i, converted: "https://fkrt.co/MINE", changed: true, error: null, service: "ExtraPe" }; },
}));
vi.mock("@/server/telegram-converter.server", () => ({
  telegramCall: async (_t: string, method: string, body: any) => { if (method === "getChat" && st.brokenChat === body.chat_id) throw new Error("chat not found"); if (method === "getChat") return { id: body.chat_id === "@dealfetch" ? -1001 : -1002 }; st.sent.push(body); return { message_id: 1 }; },
  recall: async () => new Map(), remember: async () => {}, reuseKey: (u: string) => `c:${u}`, alertIfKeyFailed: async () => {},
  claimProducts: async (_db: any, keys: string[], ms: number) => keys.filter((k) => { const fresh = (st.claims.get(k) ?? 0) <= Date.now() - ms; if (fresh) st.claims.set(k, Date.now()); return fresh; }),
  releaseProducts: async (_db: any, keys: string[]) => { for (const k of keys) st.claims.delete(k); },
}));
globalThis.fetch = (async () => new Response("{}")) as any;

const { onMessage } = await import("@/server/private-reader.server");
const now = () => Math.floor(Date.now() / 1000);
const tap = (id: number, price = "3,379") => ({ id, date: now(), message: `INVICTA Watch - For Men\n\nPrice: ₹${price}\n\nSuperCoins back: ₹3,356 (99.02%)\n\nSeller: RetailNet`,
  replyMarkup: { rows: [{ buttons: [{ url: "https://fkrt.co/pC10yP" }, { data: "x" }] }] } });
const src = (name: string, id: string) => ({ name, id, entity: null, lastId: 0, retry: new Map<number, number>() });

describe("private reader pipeline", () => {
  beforeEach(() => {
    Object.assign(st, { sent: [], logs: [], seen: new Set(), claims: new Map(), convertCalls: 0, fail: false, brokenChat: "" });
    st.settings = { telegram_converter_token: "123456:abcdefghijklmnopqrstuvwxyz", converter_repeat_minutes: 5, reader_caption: "",
      reader_destinations: [{ chat: "https://t.me/dealfetch", min_price: 0 }, { chat: "https://t.me/Deltfetch", min_price: 4500 }] };
  });
  it("one source post makes one new post per channel, never a forward, with only our link", async () => {
    await onMessage(src("tapworthy", "44"), tap(1, "5,999"), "live");
    expect(st.sent.map((s) => s.chat_id)).toEqual(["-1001", "-1002"]);
    expect(st.sent[0].text).toContain("https://fkrt.co/MINE");
    expect(st.sent[0].text).not.toContain("pC10yP");
    expect(st.sent[0].text.startsWith("Supercoin Deals\n\n")).toBe(true);
    expect(st.convertCalls).toBe(1);
  });
  it("the same post seen live and by the safety poll is posted once", async () => {
    await onMessage(src("tapworthy", "44"), tap(2), "live");
    await onMessage(src("tapworthy", "44"), tap(2), "poll");
    expect(st.sent).toHaveLength(1);
  });
  it("Deltfetch only gets deals above its minimum price", async () => {
    await onMessage(src("tapworthy", "44"), tap(3, "3,379"), "live");
    expect(st.sent.map((s) => s.chat_id)).toEqual(["-1001"]);
  });
  it("same product from another source within the repeat window is skipped and logged", async () => {
    await onMessage(src("tapworthy", "44"), tap(4), "live");
    await onMessage(src("hotdealsbywd", "39"), tap(9), "live");
    expect(st.sent).toHaveLength(1);
    expect(st.logs.some((l) => l.status === "repeat")).toBe(true);
  });
  it("a link that cannot be converted posts nothing and frees the product for the next post", async () => {
    st.fail = true;
    await onMessage(src("tapworthy", "44"), tap(5), "live");
    expect(st.sent).toHaveLength(0);
    expect(st.logs.at(-1)).toMatchObject({ status: "failed", error: "ExtraPe down" });
    st.fail = false;
    await onMessage(src("tapworthy", "44"), tap(6), "live");
    expect(st.sent).toHaveLength(1);
  });
  it("a temporary failure is tried again on the next poll instead of being lost", async () => {
    st.fail = true;
    const s = src("tapworthy", "44");
    await onMessage(s, tap(10), "live");
    expect(s.retry.has(10)).toBe(true);
    st.fail = false;
    await onMessage(s, tap(10), "poll");
    expect(st.sent).toHaveLength(1);
    expect(s.retry.has(10)).toBe(false);
  });
  it("a broken channel does not stop the other channel", async () => {
    st.brokenChat = "@Brokenchan";
    st.settings.reader_destinations = [{ chat: "https://t.me/Brokenchan", min_price: 0 }, { chat: "https://t.me/dealfetch", min_price: 0 }];
    await onMessage(src("tapworthy", "44"), tap(11, "9,999"), "live");
    expect(st.sent.map((x) => x.chat_id)).toEqual(["-1001"]);
  });
  it("posts with no shop link (False alert / OOS) are ignored", async () => {
    await onMessage(src("tapworthy", "44"), { id: 7, date: now(), message: "False alert\nMVMT Watch\n\nThis deal only blinked" }, "live");
    expect(st.sent).toHaveLength(0);
    expect(st.logs).toHaveLength(0);
  });
  it("old posts are not replayed", async () => {
    await onMessage(src("tapworthy", "44"), { ...tap(8), date: now() - 600 }, "poll");
    expect(st.sent).toHaveLength(0);
  });
});
