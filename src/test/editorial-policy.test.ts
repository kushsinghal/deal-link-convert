// Editorial draft defaults, publication visibility and legacy source IDs; storage/network are MOCKED.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDeal, fetchSource, listDeals, listSources, originalPost, goDeal, priceHistory } from "@/server/core.server";
import { saveReview, reviewDeals } from "@/server/review.server";
const state = vi.hoisted(() => ({ tables: { deals: [], sources: [] } as { deals: any[]; sources: any[]; [key: string]: any[] }, sent: 0, sourceTime: new Date(Date.now() - 60_000).toISOString() }));
vi.mock("@/server/engine.server", async load => {
  const actual = await load<typeof import("@/server/engine.server")>();
  return { ...actual, cleanLink: async (url: string) => url, convertLink: async () => "https://fkrt.co/TEST_link", phSupported: () => false,
    fetchOgImage: async () => null, sendTelegram: async () => { state.sent++; return { ok: true }; },
    fetchRss: async () => [{ ext_id: "TEST_post", text: "TEST imported product 80% off https://www.flipkart.com/TEST_item/p/itmtest", links: ["https://www.flipkart.com/TEST_item/p/itmtest"], image: "https://example.org/TEST_image", posted_at: state.sourceTime }] };
});
vi.mock("@/server/db.server", () => {
  const matches = (row: any, filter: any) => Object.entries(filter).every(([key, value]: any) => value && typeof value === "object" && "$exists" in value ? (key in row) === value.$exists : row[key] === value);
  const collection = (name: string) => ({
    find: (filter: any) => { const cursor: any = { sort: () => cursor, limit: () => cursor, toArray: async () => (state.tables[name] || []).filter(r => matches(r, filter)).map(row => ({ ...row })) }; return cursor; },
    updateOne: async (filter: any, patch: any) => { const row = (state.tables[name] || []).find(r => matches(r, filter)); if (row) Object.assign(row, patch.$set); return { matchedCount: row ? 1 : 0 }; },
    findOneAndUpdate: async (filter: any, patch: any) => { const row = (state.tables[name] || []).find(r => matches(r, filter)); if (!row) return null; const previous = { ...row }; Object.assign(row, patch.$set); for (const [key, value] of Object.entries(patch.$inc || {})) row[key] = (row[key] || 0) + Number(value); return previous; },
  });
  return { mongo: async () => ({ collection }), db: { from: (name: string) => {
    let op = "select", patch: any, single = false;
    const filters: any = {};
    const q: any = { select: () => q, eq: (key: string, value: any) => { filters[key] = value; return q; }, neq: () => q,
      gte: () => q, or: () => q, not: () => q, order: () => q, limit: () => q, in: () => q, contains: () => q, is: (key: string, value: any) => { filters[key] = value; return q; },
      maybeSingle: () => { single = true; return q; }, insert: (row: any) => { op = "insert"; patch = row; return q; }, update: (row: any) => { op = "update"; patch = row; return q; },
      then: (resolve: any) => {
        if (name === "settings") return Promise.resolve({ data: { auto_post: true, website_max_age_hours: 720 }, error: null }).then(resolve);
        const rows = state.tables[name] ||= [];
        if (op === "insert") rows.push({ ...patch });
        const hits = rows.filter(r => matches(r, filters));
        if (op === "update") hits.forEach(r => Object.assign(r, patch));
        return Promise.resolve({ data: single ? hits[0] || null : hits, error: null }).then(resolve);
      },
    }; return q;
  } } };
});
beforeEach(() => { state.tables = { deals: [], sources: [] }; state.sent = 0; });
describe("review policy", () => {
  it("keeps manual deals private even if post_now is requested", async () => {
    const result = await addDeal({ title: "TEST manual product", url: "https://www.flipkart.com/TEST_item/p/itmtest", image: "https://example.org/TEST_image", post_now: true });
    expect(result.deal.publication_status).toBe("draft");
    expect(result.post_results).toEqual([]);
    expect(state.sent).toBe(0);
  });
  it("auto-publishes imported offers by default and preserves original source time", async () => {
    const result = await fetchSource({ id: "TEST_source", name: "TEST source", kind: "rss", value: "https://example.org/feed" });
    expect(result.new_deals).toBe(1);
    expect(state.tables.deals[0]).toMatchObject({ publication_status: "published", posted_at: state.sourceTime, posted_to: [] });
    expect(state.sent).toBe(0);
  });
  it("filters drafts from every public deal read but includes them in review", async () => {
    state.tables.deals = [{ id: "TEST_draft", title: "TEST draft product", publication_status: "draft", posted_at: new Date().toISOString() }];
    expect(await reviewDeals()).toHaveLength(1);
    expect(await listDeals({})).toEqual([]);
    for (const read of [originalPost, goDeal, priceHistory]) await expect(read("TEST_draft")).rejects.toMatchObject({ status: 404 });
  });
  it("requires original advice and confirmation, supports publication and unpublication", async () => {
    state.tables.deals = [{ id: "TEST_review", title: "TEST original product", publication_status: "draft" }];
    await expect(saveReview("TEST_review", { title: "short", publish: true })).rejects.toThrow("8 and 180");
    await expect(saveReview("TEST_review", { title: "TEST reviewed product", editorial_note: "short", publish: true, review_confirmed: true })).rejects.toThrow("80 characters");
    await expect(saveReview("TEST_review", { title: "TEST reviewed product", editorial_note: "x".repeat(80), publish: true })).rejects.toThrow("checklist");
    expect(await saveReview("TEST_review", { title: "TEST reviewed product", editorial_note: "x".repeat(80), publish: true, review_confirmed: true })).toBe(true);
    expect(state.tables.deals[0]).toMatchObject({ publication_status: "published", published_at: expect.any(String) });
    expect(await listDeals({})).toHaveLength(1);
    await saveReview("TEST_review", { title: "TEST reviewed product", publish: false });
    expect(state.tables.deals[0]).toMatchObject({ publication_status: "draft", published_at: null });
    expect(await listDeals({})).toEqual([]);
  });
  it("repairs missing source IDs and returns stable IDs on subsequent reads", async () => {
    state.tables.sources = [{ _id: "TEST_legacy_object", name: "TEST legacy", kind: "telegram", value: "TEST_legacy" }];
    const first = await listSources();
    expect(first[0]).toMatchObject({ id: expect.any(String), created_at: expect.any(String) });
    expect((await listSources())[0].id).toBe(first[0].id);
  });
});