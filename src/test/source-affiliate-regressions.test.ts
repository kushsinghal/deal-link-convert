// Affiliate business errors and source reader/normalization regressions; network is MOCKED.
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertAffiliate } from "@/server/affiliate.server";
import { fetchRss, fetchTelegram, convertLink } from "@/server/engine.server";
import { normalizeSource, normalizeTelegram } from "@/server/source-input.server";
afterEach(() => vi.unstubAllGlobals());
describe("ExtraPe response safety", () => {
  it("decodes an encoded HTTPS earning link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ convertedText: "https%3A%2F%2Ffkrt.co%2FiT6yxW" })));
    expect(await convertLink("https://www.flipkart.com/item/p/itm123", { extrape_token: "TEST_token" })).toBe("https://fkrt.co/iT6yxW");
  });
  it("rejects HTTP-200 Amazon eligibility errors even with original URL and punctuation", async () => {
    const url = "https://www.amazon.in/dp/B0BDHX8Z63";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ errorCode: "INVALID_URL", errorMessage: "Amazon program approval or Associates tag required", convertedText: `${url}.` })));
    expect(await convertAffiliate(url, { extrape_token: "TEST_token" })).toMatchObject({ changed: false, converted: url, error: expect.stringContaining("Amazon conversion requires approval") });
  });
  it("does not treat an unchanged punctuated original as success", async () => {
    const url = "https://www.flipkart.com/item/p/itm123";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ convertedText: `${url}.` })));
    expect(await convertAffiliate(url, { extrape_token: "TEST_token" })).toMatchObject({ changed: false, converted: url, error: expect.stringContaining("no converted link") });
  });
});
describe("Source input and reader errors", () => {
  it("normalizes public Telegram formats", () => {
    for (const value of ["@telegram", "t.me/telegram", "https://t.me/telegram/123?single", "https://t.me/s/telegram/123"]) expect(normalizeTelegram(value)).toBe("telegram");
    expect(() => normalizeTelegram("https://t.me/+privateinvite")).toThrow("public channel");
  });
  it("rejects unknown kinds and unsafe URL syntax", () => {
    expect(() => normalizeSource("unknown", "https://example.org")).toThrow("Choose Telegram");
    for (const value of ["bad-url", "file:///tmp/file", "http://127.0.0.1", "https://user:pass@example.org"]) expect(() => normalizeSource("rss", value)).toThrow();
  });
  it("distinguishes empty RSS, HTML and malformed XML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<rss version="2.0"><channel><title>Empty</title></channel></rss>')));
    expect(await fetchRss("https://example.org/feed")).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><html><body>Not feed</body></html>")));
    await expect(fetchRss("https://example.org/feed")).rejects.toThrow("web page, not an RSS");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<rss><channel></rss>")));
    await expect(fetchRss("https://example.org/feed")).rejects.toThrow("malformed XML");
  });
  it("distinguishes an unavailable Telegram preview from an empty public channel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Private</html>")));
    await expect(fetchTelegram("TEST_missingchannel")).rejects.toThrow("public preview unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<div class="tgme_channel_info_header">Empty</div>')));
    expect(await fetchTelegram("TEST_emptychannel")).toEqual([]);
  });
});