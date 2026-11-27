import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  apiRow: null as any,
  logs: [] as any[],
  cache: new Map<string, any>(),
};

vi.mock("@/server/db.server", () => ({
  mongo: async () => ({
    collection: (name: string) => {
      if (name === "converter_api") {
        return {
          findOne: async () => state.apiRow,
          updateOne: async (_q: any, u: any) => {
            if (u.$set) state.apiRow = { ...(state.apiRow || {}), ...u.$set };
            if (u.$inc) {
              state.apiRow = state.apiRow || {};
              for (const [k, v] of Object.entries(u.$inc)) {
                state.apiRow[k] = (state.apiRow[k] || 0) + Number(v);
              }
            }
          },
        };
      }
      if (name === "converter_api_logs") {
        return {
          insertMany: async (rows: any[]) => {
            state.logs.push(...rows);
          },
          find: () => ({
            sort: () => ({
              limit: (n: number) => ({
                toArray: async () => [...state.logs].reverse().slice(0, n),
              }),
            }),
          }),
          deleteMany: async () => {
            state.logs = [];
          },
        };
      }
      return {
        findOne: async () => null,
        updateOne: async () => {},
        find: () => ({ toArray: async () => [], sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
      };
    },
  }),
}));

vi.mock("@/server/core.server", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getSettings: async () => ({
    amazon_tag: "mytag-21",
    extrape_token: "ext-tok",
    affiliate_routes: { Amazon: "amazon" },
  }),
}));

vi.mock("@/server/rate-limit.server", () => ({
  takeRateLimit: async () => true,
}));

describe("converter API dashboard logging & stats", () => {
  beforeEach(async () => {
    state.apiRow = null;
    state.logs = [];
    state.cache.clear();
    const pr = await import("@/server/private-reader.server");
    vi.spyOn(pr, "hedgedConvert").mockImplementation(async (step: any) => {
      if (String(step.original).includes("fail-me")) {
        return { original: step.original, cleaned: step.cleaned, converted: step.cleaned, changed: false, error: "ExtraPe down" };
      }
      return {
        original: step.original,
        cleaned: step.cleaned,
        converted: `https://extp.in/demo?u=${encodeURIComponent(step.cleaned)}`,
        changed: true,
        service: "ExtraPe",
      };
    });
    const tc = await import("@/server/telegram-converter.server");
    vi.spyOn(tc, "reuseKey").mockImplementation((u: string) => u);
    vi.spyOn(tc, "recall").mockImplementation(async (_db: any, keys: string[]) => {
      const m = new Map();
      for (const k of keys) if (state.cache.has(k)) m.set(k, state.cache.get(k));
      return m;
    });
    vi.spyOn(tc, "remember").mockImplementation(async (_db: any, entries: [string, any, number][]) => {
      for (const [k, v] of entries) state.cache.set(k, v);
    });
  });

  it("logs converted, failed, and unsupported links and aggregates summary stats", async () => {
    const capi = await import("@/server/converter-api.server");
    const { key } = await capi.newApiKey();

    const req = new Request("http://localhost/api/public/v1/convert", {
      method: "POST",
      headers: {
        "x-api-key": key,
        origin: "https://other-site.example",
      },
    });

    const res: any = await capi.apiConvert(req, {
      urls: [
        "https://www.flipkart.com/apple-iphone-15/p/itm6ac6485515ae4?affid=someoneelse",
        "https://www.amazon.in/dp/B0CHX1W1XY?fail-me=1",
        "https://x.com/somepost",
      ],
    });

    expect(res.converted).toBe(1);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[1].ok).toBe(false);
    expect(res.results[1].error).toBe("ExtraPe down");
    expect(res.results[2].error).toBe("Not a supported shop link");

    // Wait a microtask for void insertMany/updateOne
    await new Promise((r) => setTimeout(r, 10));

    const dash = await capi.apiLogs(50);
    expect(dash.status.uses).toBe(1);
    expect(dash.summary.total).toBe(3);
    expect(dash.summary.converted).toBe(1);
    expect(dash.summary.failed).toBe(1);
    expect(dash.summary.unsupported).toBe(1);
    expect(dash.summary.by_service).toEqual({ ExtraPe: 1 });
    expect(dash.summary.by_store).toEqual({ Flipkart: 1, Amazon: 1 });
    expect(dash.logs[0].caller).toBe("https://other-site.example");

    await capi.clearApiLogs();
    const afterClear = await capi.apiLogs(50);
    expect(afterClear.logs).toHaveLength(0);
    expect(afterClear.status.uses).toBe(1);
  });
});
