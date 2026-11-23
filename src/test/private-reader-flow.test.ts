import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ sent: [] as any[], logs: [] as any[], seen: new Set<string>(), claims: new Map<string, number>(), convertCalls: 0, fail: false, brokenChat: "", slowExtrape: false, marked: [] as string[], signals: [] as any[], posts: new Map<string, any>(), settings: {} as any }));
vi.mock("@/server/db.server", () => ({ mongo: async () => ({ collection: (name: string) => ({
  insertOne: async (doc: any) => { if (name === "reader_seen") { if (st.seen.has(doc._id)) throw Object.assign(new Error("dup"), { code: 11000 }); st.seen.add(doc._id); } else st.logs.push(doc); },
  insertMany: async (docs: any[]) => { st.logs.push(...docs); },
  findOne: async () => null, createIndex: async () => {},
  updateOne: async (q: any, u: any) => { if (name === "reader_posts") { const d = st.posts.get(q._id) || { _id: q._id, posts: [] }; Object.assign(d, u.$set); d.posts.push(...(u.$push?.posts?.$each || [])); st.posts.set(q._id, d); } },
  findOneAndUpdate: async (q: any, u: any) => { const d = st.posts.get(q._id); if (!d || d.sold_out) return null; const before = { ...d }; Object.assign(d, u.$set); return before; },
  deleteOne: async ({ _id }: any) => { st.seen.delete(_id); },
}) }) }));
vi.mock("@/server/core.server", () => ({ getSettings: async () => st.settings }));
vi.mock("@/server/affiliate.server", async (load) => ({ ...(await load<any>()),
  cleanAffiliate: async (u: string) => ({ original: u, cleaned: "https://www.flipkart.com/w/p/itm1?pid=WATHK63SGJGKHYED&lid=LSTWATHK63SGJGKHYEDXXIHUG", store: "Flipkart", pending: true }),
  finishAffiliate: async (i: any, set: any) => { st.convertCalls++;
    st.signals.push([set.force_service, set.cancel_signal]);
    if (st.slowExtrape && set.force_service === "extrape") { await new Promise((r) => setTimeout(r, 300)); return { ...i, converted: "https://fkrt.co/EXTRAPE", changed: true, error: null, service: "ExtraPe" }; }
    if (set.force_service === "sankmo") return { ...i, converted: "https://fkrt.co/SANKMO", changed: true, error: null, service: "Sankmo" };
    return st.fail ? { ...i, error: "ExtraPe down", changed: false } : { ...i, converted: "https://fkrt.co/MINE", changed: true, error: null, service: "ExtraPe" }; },
}));
vi.mock("@/server/telegram-converter.server", () => ({
  telegramCall: async (_t: string, method: string, body: any) => { if (method === "getChat" && st.brokenChat === body.chat_id) throw new Error("chat not found"); if (method === "getChat") return { id: body.chat_id === "@dealfetch" ? -1001 : -1002 }; st.sent.push({ method, ...body }); return { message_id: 77 }; },
  markReaderPost: (u: string[]) => { st.marked.push(...u); }, recall: async () => new Map(), remember: async () => {}, reuseKey: (u: string) => `c:${u}`, alertIfKeyFailed: async () => {},
  claimProducts: async (_db: any, keys: string[], ms: number) => keys.filter((k) => { const fresh = (st.claims.get(k) ?? 0) <= Date.now() - ms; if (fresh) st.claims.set(k, Date.now()); return fresh; }),
  releaseProducts: async (_db: any, keys: string[]) => { for (const k of keys) st.claims.delete(k); },
}));
globalThis.fetch = (async () => new Response("{}")) as any;

const { onMessage, hedgedConvert, forgetReaderSettings, isSoldOut } = await import("@/server/private-reader.server");
const now = () => Math.floor(Date.now() / 1000);
const tap = (id: number, price = "3,379") => ({ id, date: now(), message: `INVICTA Watch - For Men\n\nPrice: ₹${price}\n\nSuperCoins back: ₹3,356 (99.02%)\n\nSeller: RetailNet`,
  replyMarkup: { rows: [{ buttons: [{ url: "https://fkrt.co/pC10yP" }, { data: "x" }] }] } });
const src = (name: string, id: string) => ({ name, id, entity: null, lastId: 0, retry: new Map<number, number>() });

describe("private reader pipeline", () => {
  beforeEach(() => {
    forgetReaderSettings();
    Object.assign(st, { sent: [], logs: [], seen: new Set(), claims: new Map(), convertCalls: 0, fail: false, brokenChat: "", slowExtrape: false, marked: [], signals: [], posts: new Map() });
    st.settings = { reader_post_bot: "converter", telegram_converter_token: "123456:abcdefghijklmnopqrstuvwxyz", converter_repeat_minutes: 5, reader_caption: "",
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
  it("our own post is marked so the converter bot leaves it alone", async () => {
    await onMessage(src("tapworthy", "44"), tap(12), "live");
    expect(st.marked).toEqual(["https://fkrt.co/MINE"]);
  });
  it("slow ExtraPe: Sankmo is asked after the wait and the first working link wins", async () => {
    st.slowExtrape = true;
    const p = { original: "u", cleaned: "c", store: "Flipkart", pending: true };
    const r = await hedgedConvert(p, { tg_session: "x", extrape_token: "y" }, 50);
    expect(r.converted).toBe("https://fkrt.co/SANKMO");
    const fast = await hedgedConvert(p, { tg_session: "x", extrape_token: "y" }, 1000);
    expect(fast.converted).toBe("https://fkrt.co/EXTRAPE");
  });
  it("with Sankmo backup off, the reader converts with ExtraPe only", async () => {
    st.slowExtrape = true;
    st.settings.tg_session = "x"; st.settings.extrape_token = "y"; st.settings.reader_use_sankmo = false;
    await onMessage(src("tapworthy", "44"), tap(13), "live");
    expect(st.sent[0].text).toContain("https://fkrt.co/EXTRAPE");
  });
  it("your converter order decides who goes first", async () => {
    const p = { original: "u2", cleaned: "c2", store: "Flipkart", pending: true };
    const r = await hedgedConvert(p, { tg_session: "x", extrape_token: "y", converter_order: ["sankmo", "extrape", "earnkaro"] }, 1000);
    expect(r.converted).toBe("https://fkrt.co/SANKMO");
    expect(st.signals[0][0]).toBe("sankmo");
  });
  it("the slower converter is cancelled once the other answers", async () => {
    st.slowExtrape = true;
    const p = { original: "u3", cleaned: "c3", store: "Flipkart", pending: true };
    await hedgedConvert(p, { tg_session: "x", extrape_token: "y" }, 50);
    const extrape = st.signals.find(([k]) => k === "extrape");
    expect(extrape[1].aborted).toBe(true);
  });
  it("the same product arriving from 3 channels at once is converted only once", async () => {
    st.slowExtrape = true;
    const p = { original: "u4", cleaned: "c4", store: "Flipkart", pending: true };
    const set = { extrape_token: "y" };
    const all = await Promise.all([hedgedConvert(p, set), hedgedConvert({ ...p, original: "u5" }, set), hedgedConvert({ ...p, original: "u6" }, set)]);
    expect(all.map((x) => x.converted)).toEqual(Array(3).fill("https://fkrt.co/EXTRAPE"));
    expect(st.convertCalls).toBe(1);
  });
  it("recognises sold-out marks from the sources", () => {
    for (const t of ["❌ OOS · blinked for 22 sec", "❌ OOS · lasted 1 sec", "Out of stock now", "Sold out!"]) expect(isSoldOut(t)).toBe(true);
    for (const t of ["100% SuperCoin Deal BACK in STOCK!", "Still available", "INVICTA Watch"]) expect(isSoldOut(t)).toBe(false);
  });
  it("when the source edits its post to OOS, our posts get a Sold out line once", async () => {
    await new Promise((r) => setTimeout(r, 1100));
    await onMessage(src("Flipkart_scdeals_PranayCC", "55"), tap(20, "9,999"), "live");
    await new Promise((r) => setTimeout(r, 20));
    expect(st.posts.get("55:20").posts.map((p: any) => p.message_id)).toEqual([77, 77]);
    const { markSoldOut } = await import("@/server/private-reader.server");
    await markSoldOut({ id: "55", name: "x" }, 20);
    await markSoldOut({ id: "55", name: "x" }, 20);
    const edits = st.sent.filter((x) => x.method === "editMessageText");
    expect(edits).toHaveLength(2);
    expect(edits[0].text.endsWith("\n\n❌ Sold out")).toBe(true);
    expect(edits[0].message_id).toBe(77);
  });
  it("a sold-out reply to the source post also marks our post", async () => {
    await onMessage(src("Flipkart_scdeals_PranayCC", "55"), tap(21), "live");
    await new Promise((r) => setTimeout(r, 20));
    await onMessage(src("Flipkart_scdeals_PranayCC", "55"), { id: 22, date: now(), message: "❌ OOS · lasted 1 sec", replyTo: { replyToMsgId: 21 } }, "live");
    await new Promise((r) => setTimeout(r, 20));
    expect(st.sent.filter((x) => x.method === "editMessageText")).toHaveLength(1);
  });
  it("a 'price increased' reply marks Sold out; a deleted source post adds Deal expired", async () => {
    await new Promise((r) => setTimeout(r, 1100));
    await onMessage(src("Flipkart_scdeals_PranayCC", "55"), tap(30, "8,888"), "live");
    await new Promise((r) => setTimeout(r, 20));
    await onMessage(src("Flipkart_scdeals_PranayCC", "55"), { id: 31, date: now(), message: "Price increased", replyTo: { replyToMsgId: 30 } }, "live");
    await new Promise((r) => setTimeout(r, 20));
    const sold = st.sent.filter((x) => x.method === "editMessageText");
    expect(sold.length).toBeGreaterThan(0);
    expect(sold.every((e: any) => e.text.endsWith("\n\n❌ Sold out"))).toBe(true);
    st.claims.clear();
    await onMessage(src("Flipkart_scdeals_PranayCC", "55"), tap(32, "7,777"), "live");
    await new Promise((r) => setTimeout(r, 20));
    const { markSoldOut } = await import("@/server/private-reader.server");
    await markSoldOut({ id: "55", name: "x" }, 32, "❌ Deal expired");
    const expired = st.sent.filter((x) => x.method === "editMessageText" && x.text.endsWith("❌ Deal expired"));
    expect(expired.length).toBeGreaterThan(0);
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
