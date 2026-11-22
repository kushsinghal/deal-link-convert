import { afterEach, describe, expect, it, vi } from "vitest";
import { convertAffiliateText } from "@/server/affiliate.server";
import { adminSettingsView } from "@/server/core.server";
import * as converter from "@/server/telegram-converter.server";
const { pairingCode, validPairing, receiveConverter, webhookSecret } = converter;

const state = vi.hoisted(() => ({ paired: false, done: false, sends: [] as any[] }));
vi.mock("@/server/db.server", () => ({ mongo: async () => ({ collection: (name: string) => ({
  findOne: async () => name === "telegram_converter_chats" ? state.paired ? {} : null : state.done ? { done: true } : null,
  insertOne: async () => { if (name === "telegram_converter_updates" && state.done) throw Object.assign(new Error("dup"), { code: 11000 }); return {}; },
  insertMany: async () => ({}),
  bulkWrite: async () => ({}),
  createIndex: async () => ({}),
  deleteMany: async () => ({}),
  find: () => ({ toArray: async () => [], limit: () => ({ toArray: async () => [] }) }),
  updateOne: async (_filter: any, patch: any) => { if (patch.$set?.done) state.done = true; return { modifiedCount: 1 }; },
}) }), db: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "main", telegram_converter_token: "123456:" + "a".repeat(30), sankmo_token: "configured", earnkaro_token: "configured" }, error: null }) }) }) }) } }));

afterEach(() => { converter.resetConverterCaches(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); state.paired = false; state.done = false; state.sends = []; });
const token = "123456:" + "a".repeat(30);
function mockProviders() {
  // Isolate MOCKED backup tests from the live secure ExtraPe environment.
  vi.stubEnv("EXTRAPE_SESSION_SECRET", "");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("sankmo.in")) return Response.json({ convertedText: "" });
    if (url.includes("ekaro-api")) {
      const body = JSON.parse(String(init?.body));
      expect(body.deal).not.toContain("affid=");
      expect(body.deal).not.toContain("tag=");
      return Response.json({ success: 1, data: "https://ekaro.in/mine" });
    }
    state.sends.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, result: {} });
  }));
}

describe("Telegram affiliate conversion", () => {
  it("preserves original text, punctuation, spaces and repeated URLs while cleaning tracking before fallback", async () => {
    mockProviders();
    const url = "https://www.flipkart.com/item/p/itm123?affid=someone";
    const text = `  🎁 Deal ₹399!\n${url},\nAgain ${url}.  `;
    const result = await convertAffiliateText(text, { sankmo_token: "configured", earnkaro_token: "configured", affiliate_routes: { Flipkart: "sankmo" } });
    expect(result.message).toBe("  🎁 Deal ₹399!\n@Flipkart,\nAgain @Flipkart.  ");
    expect(result.entities).toEqual([
      { type: "text_link", offset: 16, length: 9, url: "https://ekaro.in/mine" },
      { type: "text_link", offset: 33, length: 9, url: "https://ekaro.in/mine" },
    ]);
    expect(result.items[0]?.cleaned).toBe("https://www.flipkart.com/item/p/itm123");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("routes Amazon directly to EarnKaro and keeps hidden link text and bold entity offsets", async () => {
    mockProviders();
    const text = "🎁 Shop now";
    const result = await convertAffiliateText(text, { earnkaro_token: "configured", affiliate_routes: { Amazon: "sankmo" } }, [{ type: "text_link", offset: 3, length: 8, url: "https://www.amazon.in/dp/B000000001?tag=other-21" }, { type: "bold", offset: 3, length: 8 }]);
    expect(result.message).toBe(text);
    expect(result.entities[0]).toEqual({ type: "text_link", offset: 3, length: 8, url: "https://ekaro.in/mine" });
    expect(result.entities[1]).toEqual({ type: "bold", offset: 3, length: 8 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("adjusts formatting offsets after visible URLs change length", async () => {
    mockProviders();
    const url = "https://www.amazon.in/dp/B000000001";
    const result = await convertAffiliateText(`${url} 🎉 End`, { earnkaro_token: "configured" }, [{ type: "url", offset: 0, length: url.length }, { type: "bold", offset: url.length + 4, length: 3 }]);
    expect(result.message).toBe("@Amazon 🎉 End");
    expect(result.entities).toContainEqual({ type: "text_link", offset: 0, length: 7, url: "https://ekaro.in/mine" });
    expect(result.entities).toContainEqual(expect.objectContaining({ type: "bold", offset: 11, length: 3 }));
  });
  it("never exposes bot tokens in settings", () => {
    const view = adminSettingsView({ telegram_converter_token: token });
    expect(view.telegram_converter_token).toBeUndefined();
    expect(view.telegram_converter_token_masked).not.toContain(token);
  });
  it("requires a signed unexpired pairing command", () => {
    vi.stubEnv("SESSION_SECRET", "test-session-signing-secret-for-telegram");
    const code = pairingCode(token);
    expect(validPairing(code, token)).toBe(true);
    expect(validPairing(code, token + "x")).toBe(false);
    expect(validPairing("0_" + code.split("_")[1], token)).toBe(false);
  });
  it("rejects unsigned webhooks and ignores unpaired chats before provider calls", async () => {
    vi.stubEnv("SESSION_SECRET", "test-session-signing-secret-for-telegram");
    mockProviders();
    const body = { update_id: 1, message: { message_id: 2, chat: { id: 3, type: "private" }, text: "https://www.amazon.in/dp/B000000001" } };
    const bad = await receiveConverter(new Request("https://app.test"), body);
    expect(bad.status).toBe(401);
    const good = await receiveConverter(new Request("https://app.test", { headers: { "x-telegram-bot-api-secret-token": webhookSecret(token) } }), body);
    expect(good.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("connects a chat with the /Radhe command without a code", async () => {
    vi.stubEnv("SESSION_SECRET", "test-session-signing-secret-for-telegram");
    mockProviders();
    const request = new Request("https://app.test", { headers: { "x-telegram-bot-api-secret-token": webhookSecret(token) } });
    for (const text of ["/Radhe", "@radhe"]) {
      state.sends = [];
      expect((await receiveConverter(request, { update_id: 9, message: { message_id: 2, chat: { id: 3, type: "private" }, text } })).status).toBe(200);
      expect(state.sends[0].body.text).toContain("Connected");
    }
  });

  it("replies to paired direct chats and deduplicates Telegram retries", async () => {
    vi.stubEnv("SESSION_SECRET", "test-session-signing-secret-for-telegram");
    mockProviders(); state.paired = true;
    const body = { update_id: 1, message: { message_id: 2, chat: { id: 3, type: "private" }, text: "Deal! https://www.flipkart.com/item/p/itm123?affid=other" } };
    const request = new Request("https://app.test", { headers: { "x-telegram-bot-api-secret-token": webhookSecret(token) } });
    const first = await receiveConverter(request, body);
    expect(first.status).toBe(200);
    const sent = await first.json();
    expect(sent).toMatchObject({ method: "sendMessage", chat_id: 3, text: "Deal! @Flipkart" });
    expect(sent.entities).toEqual([{ type: "text_link", offset: 6, length: 9, url: "https://ekaro.in/mine" }]);
    await converter.lastBackground;
    expect(await (await receiveConverter(request, body)).json()).toEqual({ ok: true });
    expect(state.sends).toHaveLength(0);
  });
  it("converts shop links only, including links typed without http, and removes other links while text stays", async () => {
    mockProviders();
    const text = "Loot amzn.to/abc and news https://example.org/story ok";
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("amzn.to")) return new Response("", { status: 302, headers: { location: "https://www.amazon.in/dp/B000000001?tag=other-21" } });
      if (url.includes("ekaro-api")) return Response.json({ success: 1, data: "https://ekaro.in/mine" });
      return new Response("<html></html>");
    }));
    const result = await convertAffiliateText(text, { earnkaro_token: "configured", amazon_route: "earnkaro", affiliate_routes: { Other: "original" } }, [{ type: "url", offset: 5, length: 11 }, { type: "url", offset: 26, length: 25 }]);
    expect(result.message).toBe("Loot @Amazon and news @Link ok");
    expect(result.entities).toEqual([{ type: "text_link", offset: 5, length: 7, url: "https://ekaro.in/mine" }, { type: "text_link", offset: 22, length: 5, url: "https://example.org/story" }]);
  });
  it("edits paired channel posts in place instead of reposting", async () => {
    vi.stubEnv("SESSION_SECRET", "test-session-signing-secret-for-telegram");
    mockProviders(); state.paired = true;
    const body = { update_id: 1, channel_post: { message_id: 2, chat: { id: -100123, type: "channel" }, caption: "Offer https://www.amazon.in/dp/B000000001" } };
    const request = new Request("https://app.test", { headers: { "x-telegram-bot-api-secret-token": webhookSecret(token) } });
    expect((await receiveConverter(request, body)).status).toBe(200);
    expect(state.sends[0].url).toContain("/editMessageCaption");
    expect(state.sends[0].body).toMatchObject({ chat_id: -100123, message_id: 2, caption: "Offer @Amazon", caption_entities: [{ type: "text_link", offset: 6, length: 7, url: "https://ekaro.in/mine" }] });
  });
  it("expands and reconverts ekaro links rather than trusting the domain as owned", async () => {
    mockProviders();
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      if (String(input) === "https://ekaro.in/abc") return new Response("", { status: 302, headers: { location: "https://www.flipkart.com/item/p/itm123?affid=other" } });
      if (String(input).includes("ekaro-api")) return Response.json({ success: 1, data: "https://ekaro.in/mine" });
      return new Response("<html></html>");
    }));
    const result = await convertAffiliateText("Grab https://ekaro.in/abc now", { earnkaro_token: "configured" });
    expect(fetch).toHaveBeenCalled();
    expect(result.items[0]?.cleaned).toBe("https://www.flipkart.com/item/p/itm123");
    expect(result.message).toBe("Grab @Flipkart now");
    expect(result.entities).toEqual([{ type: "text_link", offset: 5, length: 9, url: "https://ekaro.in/mine" }]);
  });
  it("removes a failed link, and its line when it stood alone, without an earning label", async () => {
    mockProviders();
    const url = "https://www.flipkart.com/item/p/itm123";
    const result = await convertAffiliateText(`Deal\n${url}\nEnd`, { sankmo_token: "", earnkaro_token: "" });
    expect(result.items[0]?.error).toBeTruthy();
    expect(result.message).toBe("Deal\nEnd");
    expect(result.entities).toEqual([]);
  });
});