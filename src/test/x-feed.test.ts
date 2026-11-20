import { describe, expect, it } from "vitest";
import { backupUrls, mapTweets, nitterUser, xUsername } from "../server/x-feed.server";

describe("feed backups", () => {
  it("builds 5 nitter mirror backups after custom feeds", () => {
    const src = { kind: "rss", value: "https://nitter.mie.foundation/GoldDealsIndia/rss", backup_urls: ["https://example.com/feed"] };
    const list = backupUrls(src);
    expect(list[0]).toBe("https://example.com/feed");
    expect(list.slice(1)).toHaveLength(5);
    expect(list.every((u) => !u.includes("nitter.mie.foundation"))).toBe(true);
    expect(nitterUser(src.value)).toBe("GoldDealsIndia");
    expect(xUsername(src)).toBe("GoldDealsIndia");
    expect(backupUrls({ kind: "telegram", value: "deals" })).toEqual([]);
  });
  it("maps X API posts into deal items with real links and images", () => {
    const items = mapTweets({
      data: [{ id: "123", text: "Boat headset ₹999 https://t.co/a https://t.co/q", created_at: "2026-06-01T10:00:00.000Z", attachments: { media_keys: ["m1"] },
        entities: { urls: [{ url: "https://t.co/a", expanded_url: "https://www.flipkart.com/boat/p/itm1" }, { url: "https://t.co/q", expanded_url: "https://x.com/someone/status/9" }] } }],
      includes: { media: [{ media_key: "m1", url: "https://pbs.twimg.com/a.jpg" }] },
    }, "deals");
    expect(items[0]).toMatchObject({ ext_id: "123", links: ["https://www.flipkart.com/boat/p/itm1"], image: "https://pbs.twimg.com/a.jpg", post_url: "https://x.com/deals/status/123" });
    expect(items[0].text).toBe("Boat headset ₹999 https://www.flipkart.com/boat/p/itm1");
  });
});
