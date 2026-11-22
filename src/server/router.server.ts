// @ts-nocheck — HTTP dispatcher for the app's API (public reads, admin actions, scheduled scan).
import * as core from "./core.server";
import { HttpError } from "./core.server";

type Ctx = { request: Request; url: URL; parts: string[]; body: any };

const json = (data: any, status = 200) => Response.json(data, { status });

/** Background requests must target a public host; the editor preview host sits behind a sign-in wall. */
function publicOrigin(url: URL) {
  const m = url.host.match(/^id-preview--([0-9a-f-]+)\.(.+)$/);
  if (m) return `https://project--${m[1]}-dev.${m[2]}`;
  return url.origin;
}

async function requireAdmin(request: Request) {
  const { verifyAdminToken } = await import("./auth.server");
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in as the admin");
  if (!verifyAdminToken(token)) throw new HttpError(401, "Your session expired — sign in again");
}

export async function handle(request: Request, splat: string) {
  const url = new URL(request.url);
  const parts = splat.split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method.toUpperCase();
  let body: any = {};
  if (method !== "GET" && method !== "HEAD") {
    const t = await request.text();
    if (t) {
      try { body = JSON.parse(t); } catch { return json({ detail: "Invalid JSON" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ detail: "Send a JSON object" }, 400);
    }
  }
  const qp = (k: string) => url.searchParams.get(k);
  const [a, b, c] = parts;
  const route = `${method} ${parts.length ? parts.map((p, i) => (i > 0 && /^[0-9a-f-]{8,}$/i.test(p) && !["d"].includes(p) ? ":id" : p)).join("/") : ""}`;

  try {
    if (method === "POST" && a === "telegram" && b === "converter" && !c) {
      const { receiveConverter } = await import("./telegram-converter.server");
      return await receiveConverter(request, body);
    }
    // ----- scheduled + internal -----
    // ----- public -----
    if (method === "GET") {
      if (a === "cron" && b === "fetch") {
        const { verifyCronRequest } = await import("./auth.server");
        if (!verifyCronRequest(request)) return json({ detail: "Unauthorized" }, 401);
        return json(await core.startFetchAll(publicOrigin(url), { wait: true }));
      }
      if (a === "deals" && !b) {
        const isAdmin = await requireAdmin(request).then(() => true, () => false);
        const rows = await core.listDeals({ category: qp("category"), q: qp("q"), store: qp("store"), sort: qp("sort"), limit: qp("limit") });
        return json(isAdmin ? rows : rows.map(({ source, source_id, source_post_url, text, url: _url, post_title, ...rest }: any) => rest));
      }
      if (a === "deals" && b && c === "original") await requireAdmin(request);
      if (a === "deals" && b && c === "original") return json(await core.originalPost(b));
      if (a === "price-history" && b) return json(await core.priceHistory(b));
      if (a === "stats") return json(await core.stats());
      if (a === "go" && b === "d" && c) return await core.goDeal(c);
      if (a === "go" && b && !c) return await core.goLink(b);
      if (a === "img" && b) return await (await import("./deal-images.server")).serveDealImage(b);
      if (a === "image-proxy") return await core.imageProxy(qp("url") || "");
      if (a === "public-settings") return json(await core.publicSettingsView());
    }
    if (method === "POST" && a === "cron" && b === "tick") {
      // Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
      const { verifyCronRequest } = await import("./auth.server");
      if (!verifyCronRequest(request)) return json({ detail: "Unauthorized" }, 401);
      void import("./telegram-converter.server").then((t) => t.checkConverterHealth()).catch((e) => console.error("converter health check failed", e?.message));
      const st = await core.getSettings();
      const waitMs = (Number(st.check_interval_seconds) || 300) * 1000 - 20_000 - (Date.now() - new Date(st.last_run_at || 0).getTime());
      if (waitMs > 0) return json({ queued: false, skipped: true, next_in_seconds: Math.ceil(waitMs / 1000) }, 202);
      return json(await core.startFetchAll(publicOrigin(url), { wait: false }), 202);
    }
    if (method === "POST" && a === "cron" && b === "fetch") {
      const { verifyCronRequest } = await import("./auth.server");
      if (!verifyCronRequest(request)) return json({ detail: "Unauthorized" }, 401);
      return json(await core.startFetchAll(publicOrigin(url), { wait: true }));
    }
    if (method === "POST" && a === "auth" && b === "login") {
      const { login } = await import("./auth.server");
      const token = login(String(body.password || ""));
      if (!token) return json({ detail: "Wrong password" }, 401);
      return json({ token });
    }

    if (method === "POST" && a === "deals" && b && c === "vote") {
      const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
      return json(await core.voteDeal(b, body, ip));
    }
    // ----- admin -----
    await requireAdmin(request);
    if (method === "POST" && a === "affiliate" && b === "support-check") return json(await core.startSupportCheck(), 202);
    if (method === "POST" && a === "telegram" && b === "converter") {
      const telegram = await import("./telegram-converter.server");
      if (c === "connect") {
        const origin = typeof body.origin === "string" && body.origin ? body.origin : publicOrigin(url);
        if (origin.length > 2048) throw new HttpError(400, "Site address is too long");
        return json(await telegram.connectConverter(origin));
      }
      if (c === "status") return json(await telegram.converterStatus());
      if (c === "disconnect") return json(await telegram.disconnectConverter());
      if (c === "menu") return json(await telegram.syncBotMenu());
    }
    if (a === "sankmo-bot") {
      const bot = await import("./sankmo-bot.server");
      try {
        if (method === "GET" && b === "status") return json(await bot.botStatus());
        if (method === "POST" && b === "send-code") return json(await bot.sendLoginCode(body.phone));
        if (method === "POST" && b === "verify") return json(await bot.verifyLoginCode(body.code, body.password));
        if (method === "POST" && b === "disconnect") return json(await bot.disconnectBot());
        if (method === "POST" && b === "test") return json(await bot.testBot());
      } catch (e) { return json({ detail: String(e?.message || e).slice(0, 300) }, 400); }
    }
    if (method === "POST" && a === "x" && b === "test") {
      try {
        const result = await (await import("./x-feed.server")).recentTweets(String(body.username || ""), 7);
        return json({ ...result, posts: result.items.length, sample: result.items.map((i: any) => ({ text: i.text.slice(0, 800), links: i.links, image: i.image, posted_at: i.posted_at, post_url: i.post_url })) });
      } catch (e) { return json({ detail: String(e?.message || e).slice(0, 300) }, 400); }
    }
    if (method === "GET") {
      if (a === "scan-status") return json(await core.scanStatus());
      if (a === "x" && b === "status") return json((await import("./x-feed.server")).xAccessStatus());
      if (a === "lookup") return json(await core.lookup(qp("url") || ""));
      if (a === "review-deals") return json(await (await import("./review.server")).reviewDeals());
      if (a === "sources") return json(await core.listSources());
      if (a === "destinations") return json(await core.listDestinations());
      if (a === "settings") return json(await core.readSettings());
      if (a === "logs") return json(await core.logs(Number(qp("limit") || 200)));
      if (a === "converter-logs") return json(await (await import("./telegram-converter.server")).converterLogs(Number(qp("limit")) || 200));
    }
    if (method === "POST") {
      if (a === "sources" && b === "test-all") return json(await (await import("./source-health.server")).testAllSources());
      if (a === "sources" && b && c === "test") {
        const result = await (await import("./source-health.server")).testSource(b);
        return result ? json(result) : json({ detail: "Source not found" }, 404);
      }
      if (a === "deals" && b === "reconvert") return json(await core.reconvert());
      if (a === "deals" && b === "remove-duplicates") return json(await (await import("./review.server")).removeDuplicateDeals());
      if (a === "deals" && !b) return json(await core.addDeal(body));
      if (a === "deals" && b && c === "post") return json(await core.repost(b, qp("destination_id")));
      if (a === "sources" && !b) return json(await core.addSource(body));
      if (a === "sources" && b && c === "fetch") return json(await core.fetchSourceById(b));
      if (a === "fetch-all") return json(await core.startFetchAll(publicOrigin(url), { wait: false }));
      if (a === "destinations" && !b) return json(await core.addDestination(body));
      if (a === "destinations" && b && c === "test") return json(await core.testDestination(b));
      if (a === "destinations" && b && c === "send-recent") return json(await core.sendRecent(b));
      if (a === "convert" && b === "bulk") return json(await core.convertBulk(body));
      if (a === "convert" && !b) return json(await core.convertOne(body.url));
      if (a === "telegram" && b === "chats") return json(await core.findChats(body));
    }
    if (method === "PUT") {
      if (a === "deals" && b && c === "review") {
        try {
          const saved = await (await import("./review.server")).saveReview(b, body);
          return saved ? json({ ok: true }) : json({ detail: "Deal not found" }, 404);
        } catch (error) { return json({ detail: error.message }, 400); }
      }
      if (a === "deals" && b && c === "feature") return json(await core.featureDeal(b, body.featured));
      if (a === "sources" && b) return json(await core.updateSource(b, body));
      if (a === "destinations" && b) return json(await core.updateDestination(b, body));
      if (a === "settings") return json(await core.writeSettings(body));
      if (a === "go" && b) return json(await core.setLinkImage(b, body.image));
    }
    if (method === "DELETE") {
      if (a === "deals" && b) return json(await core.deleteDeal(b));
      if (a === "sources" && b) return json(await core.deleteSource(b));
      if (a === "destinations" && b) return json(await core.deleteDestination(b));
    }
    return json({ detail: `Not found: ${route}` }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ detail: e.message }, e.status);
    if (/is not set$/.test(String(e?.message))) return json({ detail: "The site isn't connected to its database yet" }, 503);
    console.error("API error", route, e);
    return json({ detail: String(e?.message || "Server error").slice(0, 300) }, 500);
  }
}
