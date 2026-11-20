import { afterEach, describe, expect, it, vi } from "vitest";
import * as engine from "@/server/engine.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("affiliate routing", () => {
  it("converts Flipkart and Amazon through ExtraPe by default", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://www.extrape.com/handler/convertText");
      expect(new Headers(init?.headers).get("accesstoken")).toBe("ep-token");
      const { inputText } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, convertedText: `Deal ${inputText.includes("amazon") ? "https://extp.in/amz1" : "https://extp.in/fk1"}` }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const settings = { extrape_token: "ep-token", earnkaro_token: "configured" };
    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", settings)).resolves.toBe("https://extp.in/fk1");
    await expect(engine.convertLink("https://www.amazon.in/dp/B000000001", settings)).resolves.toBe("https://extp.in/amz1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to EarnKaro when ExtraPe fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("extrape.com")
      ? new Response(JSON.stringify({ success: false, errorCode: "Invalid Url" }), { status: 200 })
      : new Response(JSON.stringify({ success: 1, data: "https://ekaro.in/backup" }), { status: 200 })));
    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", { extrape_token: "ep", earnkaro_token: "configured" })).resolves.toBe("https://ekaro.in/backup");
  });

  it("reports ExtraPe errors when no EarnKaro backup exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, errorCode: "Invalid Url" }), { status: 200 })));
    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", { extrape_token: "ep" })).rejects.toThrow("ExtraPe does not support this link");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errorCode: "INVALID_AUTH_TOKEN", errorMessage: "User is Not Logged in" }), { status: 200 })));
    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", { extrape_token: "ep" })).rejects.toThrow("ExtraPe access token expired or invalid");
    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", {})).rejects.toThrow("Add your ExtraPe access token");
  });

  it("falls back from an unconverted Sankmo result to the configured EarnKaro route", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("sankmo.in")) return new Response(JSON.stringify({ convertedText: "" }), { status: 200 });
      expect(url).toBe("https://ekaro-api.affiliaters.in/api/converter/public");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ deal: "https://www.flipkart.com/item/p/itm123", convert_option: "convert_only" });
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer configured");
      return new Response(JSON.stringify({ success: 1, data: "Converted deal: https://ekaro.in/new-link" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const link = await engine.convertLink("https://www.flipkart.com/item/p/itm123", {
      sankmo_token: "configured",
      affiliate_routes: { Flipkart: "sankmo" },
      earnkaro_token: "configured",
    });

    expect(link).toBe("https://ekaro.in/new-link");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the selected affiliate service for each store", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("sankmo.in")) {
        return new Response(JSON.stringify({ convertedText: "https://fkrt.site/myntra-route" }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: 1, data: "https://ekaro.in/flipkart-route" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const settings = {
      sankmo_token: "configured",
      earnkaro_token: "configured",
      sankmo_stores: ["Flipkart", "Myntra"],
      affiliate_routes: { Flipkart: "earnkaro", Myntra: "sankmo" },
    };

    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", settings)).resolves.toBe("https://ekaro.in/flipkart-route");
    await expect(engine.convertLink("https://www.myntra.com/product", settings)).resolves.toBe("https://fkrt.site/myntra-route");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("default order is ExtraPe, then EarnKaro, then Sankmo", async () => {
    const fetchMock = vi.fn(async (input: any) => String(input).includes("extrape")
      ? new Response(JSON.stringify({ errorCode: "INVALID_URL" }), { status: 200 })
      : String(input).includes("ekaro") ? new Response(JSON.stringify({ success: 0, message: "nope" }), { status: 200 })
      : new Response(JSON.stringify({ convertedText: "https://sankmo.in/mine" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", { extrape_token: "ep", sankmo_token: "sk", earnkaro_token: "ek" })).resolves.toBe("https://sankmo.in/mine");
    expect(fetchMock.mock.calls.map((c) => new URL(String(c[0])).hostname)).toEqual(["www.extrape.com", "ekaro-api.affiliaters.in", "sankmo.in"]);
  });
  it("follows a saved converter order", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ convertedText: "https://sankmo.in/first" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(engine.convertLink("https://www.flipkart.com/item/p/itm123", { converter_order: ["sankmo", "extrape", "earnkaro"], extrape_token: "ep", sankmo_token: "sk", earnkaro_token: "ek" })).resolves.toBe("https://sankmo.in/first");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("routes Amazon through the EarnKaro backup when no ExtraPe token is saved, ignoring legacy routes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: 1, data: "https://ekaro.in/amazon-link" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(engine.convertLink("https://www.amazon.in/dp/B000000001", {
      amazon_tag: "old-tag-21",
      affiliate_routes: { Amazon: "original" },
      earnkaro_token: "configured",
    })).resolves.toBe("https://ekaro.in/amazon-link");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports EarnKaro API errors instead of treating the original URL as converted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: 1, message: "Url not found in post!" }), { status: 400 })));

    await expect(engine.convertLink("https://www.amazon.in/dp/B000000001", { earnkaro_token: "configured" }))
      .rejects.toThrow("EarnKaro: Url not found in post!");
  });
});

describe("RSS product links", () => {
  it("extracts the retailer link from an RSS description anchor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `<rss version="2.0"><channel><item><guid>offer-1</guid><title>Camera offer</title><link>https://offers.example/story</link><description><![CDATA[<p>Deal details <a href="https://www.flipkart.com/camera/p/itm1">Shop now</a></p>]]></description></item></channel></rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } },
    )));

    const [item] = await engine.fetchRss("https://offers.example/feed.xml");

    expect(item.links).toContain("https://www.flipkart.com/camera/p/itm1");
    expect(item.posted_at).toBeTruthy();
    const parsed = engine.parseItem(item.text, item.links, item.image, {});
    expect(parsed?.url).toBe("https://www.flipkart.com/camera/p/itm1");
  });
});

describe("combined Loot / Errors and Price Drop filter", () => {
  it("includes both categories without including unrelated deal categories", () => {
    expect(engine.matchesLootOrPriceDrop(["loot"])).toBe(true);
    expect(engine.matchesLootOrPriceDrop(["heavy_discount"])).toBe(true);
    expect(engine.matchesLootOrPriceDrop(["gold", "gift_card"])).toBe(false);
    expect(engine.LOOT_PRICE_DROP_CATEGORIES).toEqual(["loot", "heavy_discount"]);
  });
});

describe("payment offer extraction", () => {
  it("keeps eligible card offers but excludes EMI offers", () => {
    const offers = engine.extractOffers("₹1,200 off with HDFC Credit Card\nNo-cost EMI available for 6 months");

    expect(offers.some((offer) => offer.kind === "bank" && offer.label.includes("HDFC"))).toBe(true);
    expect(offers.some((offer) => /emi/i.test(offer.label))).toBe(false);
  });
});

describe("gold and silver deal classification", () => {
  it("requires a specific precious-metal product instead of the words gold or silver alone", () => {
    expect(engine.isGold("Gold offer today")).toBe(false);
    expect(engine.isGold("Silver savings available")).toBe(false);
    expect(engine.isGold("22K gold coin, 1 gram")).toBe(true);
    expect(engine.isGold("Gold card membership offer")).toBe(false);
    expect(engine.isGold("Tanishq special offer")).toBe(false);
    expect(engine.isGold("Buy silver earrings today")).toBe(true);
  });
});