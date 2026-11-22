import { describe, expect, it } from "vitest";
import { buildPost, messageLinks, parseDeal, priceNumber } from "@/server/private-reader-format";
import samples from "./fixtures-reader-samples.json";

const hot = `100% SuperCoin Deal BACK in STOCK!\n\nINVICTA Celestial Celestial Quartz Green Dial Anal...\nSeller: RetailNet · ₹3,379\n👉: https://fkrt.co/z5Qgqr\n\n📋 Complete List of Eligible Watches for 100% SuperCoin Back:\nhttps://wealthydimes.com/flipkart/supercoin-deals\n\n📖 Before purchasing, make sure to go through the FAQs`;
const tap = `INVICTA Celestial Celestial Quartz Green Dial Analog Watch - For Men\nhttps://fkrt.co/pC10yP\n\nPrice: ₹3,379\n\nSuperCoins back: ₹3,356 (99.02%)\n\nSeller: RetailNet\n\nTap View locations for delivery pincodes.`;
const sc = `INVICTA Celestial Quartz Green Dial Analog Watch - For Men 50471\n\n🔁 99.02% SuperCoin deal BACK in STOCK!\n🛒 https://www.flipkart.com/x/p/itmbe96058da7546?lid=LSTWATHK63SGJGKHYEDXXIHUG\n\nMRP: ₹11,500\nDiscounted price: ₹3,379\nSuperCoins back: ₹3,346 (99.02%)\nSeller: RetailNet\n\n❌ OOS · blinked for 22 sec`;

describe("private reader post format", () => {
  it("reads hotdealsbywd posts", () => {
    expect(parseDeal(hot)).toEqual({ title: "INVICTA Celestial Celestial Quartz Green Dial Anal...", price: "3,379", coins: null, seller: "RetailNet", supercoin: true });
  });
  it("reads tapworthy posts", () => {
    expect(parseDeal(tap)).toMatchObject({ title: "INVICTA Celestial Celestial Quartz Green Dial Analog Watch - For Men", price: "3,379", coins: "3,356", seller: "RetailNet" });
  });
  it("reads Flipkart_scdeals posts and prefers the discounted price", () => {
    const d = parseDeal(sc);
    expect(d).toMatchObject({ title: "INVICTA Celestial Quartz Green Dial Analog Watch - For Men 50471", price: "3,379", coins: "3,346" });
    expect(priceNumber(d.price)).toBe(3379);
  });
  it("builds the post with caption on top and only our link", () => {
    const post = buildPost(parseDeal(tap), [{ store: "Flipkart", url: "https://fkrt.co/MINE" }]);
    expect(post).toBe("Supercoin Deals\n\nINVICTA Celestial Celestial Quartz Green Dial Analog Watch - For Men\n\nPrice: ₹3,379\n\nSuperCoins: 3,356 SuperCoins cashback\n\nSeller: RetailNet\n\nBuy on Flipkart:\nhttps://fkrt.co/MINE");
    expect(buildPost(parseDeal(hot), [{ store: "Flipkart", url: "https://fkrt.co/MINE" }], "My caption").startsWith("My caption\n\n")).toBe(true);
    expect(post).not.toMatch(/pC10yP|wealthydimes|pincode|OOS/);
  });
  it("finds hidden text links and URL buttons (old and new Telegram button shapes)", () => {
    const m = { message: "Title\n\nPrice: ₹2,109", entities: [{ className: "MessageEntityTextUrl", offset: 0, length: 5, url: "https://fkrt.co/aaa" }],
      replyMarkup: { rows: [{ buttons: [{ url: "https://fkrt.co/bbb" }, { data: "cb" }] }, { buttons: [{ type: { url: "https://fkrt.co/ccc" } }] }] } };
    expect(messageLinks(m)).toEqual(["https://fkrt.co/aaa", "https://fkrt.co/bbb", "https://fkrt.co/ccc"]);
  });
  it("every real sample with a link gets a title and price", () => {
    for (const [, rows] of Object.entries(samples as Record<string, any[]>)) for (const r of rows) {
      if (!/fkrt|flipkart/.test(JSON.stringify(r.links)) && !/fkrt|flipkart/.test(r.text)) continue;
      const d = parseDeal(r.text);
      expect(d.title, r.text).toBeTruthy();
      expect(d.price, r.text).toBeTruthy();
    }
  });
});
