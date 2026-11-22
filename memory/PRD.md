# DealLoot — product requirements and handoff

## User goals and approved choices
- Original: inspect/fix affiliate deals product; replace EarnKaro default with ExtraPe because of Amazon/Flipkart profits. Keep EarnKaro as a backup.
- Latest: open preview and supply login, securely use authorised ExtraPe token, test RSS/Telegram sources, prepare files for either Emergent or Render/GitHub, and make truthful improvements for an Amazon affiliate application.
- User chose all configured source checks; default recommended imported-deal review gate. Not a registered business; approved contact `hari121vrind@gmail.com`. Use existing DealLoot name without corporate or Amazon-approval claims.
- Language: English. No actual deployment requested/performed. Do not guarantee affiliate commissions or approval.

## Actual architecture (do NOT replace with template)
- Root `/app`: TypeScript React 19 + TanStack Start, Vite 8, Nitro Node server, MongoDB.
- `src/server/engine.server.ts`: scraping/parsing, affiliate adapters, Telegram posting. `core.server.ts`: app operations. `router.server.ts`: `/api/public/*` dispatcher. `db.server.ts`: Mongo query adapter (excludes `_id`).
- Added `source-input.server.ts`, `source-health.server.ts`, `review.server.ts` for input validation, no-import diagnostics, editorial publication.
- Frontend `src/routes`, `src/views`, `src/components/admin`; guides/info content in `src/lib/editorial.ts`.
- Emergent preview: supervisor frontend `/app/frontend` invokes root Vite through `scripts/start-preview.mjs` on port 3000. `/app/backend/server.py` FastAPI adapter on port 8001 proxies `/api/*` to Node via `NODE_INTERNAL_URL`. Root application logic remains Node.
- Render: one Node service via `render.yaml`, `scripts/build-production.mjs` and `scripts/start-production.mjs`; no separate Python service.
- Environment: preserve `MONGO_URL`, `DB_NAME`, `REACT_APP_BACKEND_URL`; backend/.env restored old preview config unchanged, frontend/.env current public origin + preview forwarding hostname. Secure ExtraPe secret is injected by the platform; not a file value to print.
- Password-only existing admin access. See `memory/test_credentials.md`. Production startup requires 16+ char private password and 32+ char signing secret; never deploy preview password.

## Completed — 2026-11-20
### Startup and conversion
- Fixed fork startup mismatch without editing readonly supervisor configuration; preview web/API and password login working.
- Secure `EXTRAPE_SESSION_SECRET` received via card. getSettings uses it ahead of legacy database token; full token is never returned to browser. Admin UI identifies backend-managed token.
- ExtraPe HTTP-200 business errors were falsely considered successful because its error text contained the original URL plus a period. Fixed: errorCode/errorMessage handled before URL extraction; trailing punctuation and unchanged URLs rejected.
- ExtraPe Flipkart convertedText is percent-encoded. Decode before extracting earning link. LIVE successful conversion to `https://fkrt.co/...` verified repeatedly.
- LIVE Amazon result is an account eligibility block: ExtraPe requires Amazon programme approval or own Amazon Associates tag configured inside ExtraPe. Token replacement is NOT needed. No false success; error is actionable.
- EarnKaro fallback remains implemented and MOCKED-tested, but no live EarnKaro token exists in this fork.

### Source checks
- New source records now get IDs/timestamps (old code omitted IDs, breaking actions). Legacy missing IDs repaired on source-list read; toggling no longer blanks a name.
- Normalize Telegram @names, channel URLs and post URLs incl. /s/ and query strings; reject private invites/unknown source types and obvious unsafe syntax.
- RSS detects HTML masquerading as feed, malformed XML, and non-feed XML; supports RSS/Atom/RDF. Public Telegram empty channel vs unavailable preview distinguished.
- Sources UI Test/Test all persist status, post count, timestamp and error without importing or sending. Import drafts is separate. Error/retry/status controls and mobile wrapping improved.
- IMPORTANT: original saved sources, deals and destinations were absent from this fork database. No original source list was invented. Live checks used clearly identified temporary test records, then removed them.
- LIVE samples: Telegram @telegram readable (20); BBC RSS readable (~33); DealsMagnet readable (~5–6); DealsHeaven `/feed` HTTP404; DesiDime HTTP403. Blocked sources correctly show errors; not bypassed or claimed fixed.

### Editorial / public website
- Every imported/manual/converted deal starts as private draft. Reconversion resets review. Authenticated `/review-deals` lists drafts + published records.
- Review form edits title/advice and requires >=80 chars original advice plus explicit rights/offer checklist before publishing. Unpublish supported. No invented firsthand product tests.
- Public listings, counts, deal redirects, original-post and history entrypoints exclude drafts. Draft posts to Telegram rejected; sendRecent selects only published items.
- Price observations recorded on publication; public shared history limited to published deal IDs. Legacy unlinked history points excluded, not deleted.
- Added About, Contact, Editorial Standards, Affiliate Disclosure, Privacy, Terms, 3 original general shopping guides (illustrations are not product tests). Prominent nearby affiliate disclosures and sponsored links. Public page no longer calls admin-only scan or claims automatic live refresh.
- Contact email approved by user. No Amazon Associate membership claim; after real enrolment operator must add Amazon-required exact statement and follow current programme rules.
- Fixed manual missing/invalid URL payload 500 -> actionable400; validated basic manual numeric/text/category fields. Settings failure/retry now visible instead of blank. Improved mobile review summaries, long links and tab wrapping. SEO wording updated.

### Hosting / source handoff
- Node production build validated; Render blueprint uses Yarn lockfile, environment-supplied URL/port, database and private credentials. README documents both hosting layouts and required environment setup.
- Browser API uses configured REACT_APP_BACKEND_URL; Render public origin maps from RENDER_EXTERNAL_URL when explicit origin is absent.
- `scripts/export-source.py` creates `/public/downloads/dealloot-source.zip` (117 files) for a fresh GitHub repository. Real HTTP download/ZIP contents verified. Excludes secrets, .env files except template, tests, database, build output and Git history.
- Root `.env` from original imported history remains tracked and contains obsolete **browser-public** Supabase config. Cannot be excluded retroactively by .gitignore. No new backend secrets are tracked. Clean archive avoids legacy configuration/history. README calls this out; no Git history rewritten or pushed.
- No automatic scheduler configured. Existing authenticated cron route can be used; timing field alone doesn't schedule anything. If adding Emergent recurring imports later, load scheduled-recurring-tasks skill first.

## Verification
- Test report `/app/test_reports/iteration_1.json` read; confirmed functional/UI failures fixed.
- Final: `yarn test` **56/56**, `yarn exec tsc --noEmit` pass; production Node build pass.
- Final API pytest **11/11**: `/app/test_reports/pytest/final-preview-workflows.xml`.
- Playwright public/home/login/pages/editorial flow and source controls on desktop1920x800 + mobile390x844. Final worst-case private review fixture: summary width290px; no horizontal overflow. Settings error injection + Retry recovery pass.
- Real ExtraPe Flipkart and Amazon eligibility outcomes tested. Live sample source results stored `source-health-snapshots.json`, `source-health-test-all.json`.
- Network responses in unit tests (including EarnKaro fallback and Telegram sending) are **MOCKED**. No real Telegram message sent; no deployment performed.
- All temporary test records removed by tracked IDs. No fake offers remain publicly or privately after cleanup.

## Priorities / next actions
### P0 — user action / blocked external conditions
- Re-add original source URLs or connect the correct original database; test those exact sources. This fork has none.
- Amazon conversion needs ExtraPe Amazon eligibility or own Amazon Associates tag. Build honest original content and complete provider enrolment; no approval guarantee.
### P1
- Configure valid backup EarnKaro token if desired; verify real fallback and attribution/commission with provider.
- User review guides/policies and publish genuine reviewed offers; use owned/authorised media and useful original comparisons before applying.
- Choose host when ready; set production secrets/database and strong password. Use clean source ZIP for fresh Render/GitHub repository. Not deployed.
- Live Telegram delivery requires configured authorised bot/destination and explicit send verification.
### P2 / known limitations
- Authenticated source fetchers currently follow redirects; harden DNS/public-target checks on every hop against SSRF if expanding administrative access. Static review observation, not exploitation tested.
- Split remaining large engine/core modules; add richer regression coverage for sendRecent/public-only history changes.
- Replace unavailable third-party feeds only with authorised, verified alternative source URLs; don't bypass anti-bot restrictions.
- Optional scheduled draft import using host-supported scheduler; not an in-app interval loop.
- Suggestion: add original comparison articles with own photos and transparent pros/cons to improve visitor trust and application substance.
## 2026-11-20 (fork 2)
- Preview verified loading; vite `allowedHosts: true` so any preview host works.
- Added 7 original buying guides (10 total); 01–10 numbering fixed on home and /guides; removed lone guide image.
- Added Amazon Associate statement to footer and /info/disclosure (AMAZON_DISCLOSURE in src/lib/editorial.ts).
- Added user's 4 sources to preview DB. nitter RSS + @wealthydimes OK; @hotdealsbywd and @tapworthy have Telegram web preview disabled by owner (clear error message added).
- Testing agent iteration_2: 22/22 backend, frontend 100%.
- Amazon application still needs: live public domain (not preview URL), real published reviewed deals, own Associates tag for Amazon links (ExtraPe Amazon needs approval), 3 qualifying sales in 180 days.

## 2026-11-20 (fork 2, part 2) — Deal fetching
- Root cause of "no deals": no scheduler ran + imports were private drafts.
- Added `.emergent/crons.yml` (every 15 min) -> POST /api/public/cron/tick (Bearer WEBHOOK_CRON_SECRET in backend/.env, 202 immediate ack). Render keeps using CRON_SECRET + /cron/fetch.
- New setting `auto_publish` (default ON, Rules tab switch). Manual deals remain drafts. Unpublish via "Save as draft".
- Auto-published deals record price_history; out-of-stock/expired/ended posts skipped.
- Added user's ~40 sources. Broken: @hotdealsbywd, @tapworthy (preview disabled), desidime.com website x2 (HTTP 403).
- Age limit kept at 24h (user choice). Tests: vitest 56/56; testing agent iteration_3/4 pass.

## 2026-11-20 (fork 2, part 3) — Converter + public view
- /Radhe (also @Radhe, radhe) connects a chat to the converter bot; old /connect code still works.
- Bot notifies connected chats: Connected / Disconnected / auto-restored (cron tick runs checkConverterHealth) and ExtraPe key failure alert (throttled 6h) — converter_alerts collection.
- converter_logs collection + "Converter History" admin tab (pasted, clean, your link, store, sent/replied time, duration).
- Public: Control Room nav hidden until /admin login; share + original-post buttons removed; source names hidden (and stripped from public /deals API); /deals/:id/original admin-only; price history label "Seen on DealLoot".
- Social/WhatsApp/nitter/x links no longer ingested as deals.
- Tests: vitest 57/57; testing agent iteration_5 all pass.

## 2026-11-20 (fork 3) — Converter speed, false key alert, logout
- Bot now replies BEFORE the slow product lookup/deal save (runs in background via `lastBackground`); multiple links convert in parallel. Link conversion itself measured 0.7–1.5s live.
- ExtraPe errors split: INVALID_AUTH_TOKEN (real expired key, alerts owner) vs INVALID_URL (unsupported link, no alert). The 7:15 PM alert was a false alarm from a background import; key verified working live.
- Navbar "Log out" button (data-testid admin-logout-button) shown only when signed in; old small Sign out link removed.
- Vitest 57/57, tsc clean. Real Telegram round-trip timing NOT measured by agent (would message the owner's chat).
- Backlog: Twitter/X API instead of Nitter (P1); social-link filter expansion (wa.me, facebook, threads, telegram.dog) (P2).
- Fork 3 part 2: per-card link-type line is admin-only ("Converted link" / "Retailer link (not converted)"); page-top + footer disclosure kept. Unconverted deals stay public (user choice). Conversion chain now ExtraPe -> Sankmo -> EarnKaro (each only if token saved; Sankmo token NOT yet saved, so Sankmo backup untested live). Deals list no longer waits 200ms before first load. Vitest 58/58.
- Note: 57 published Amazon deals are unconverted (ExtraPe Amazon needs approval / own Associates tag).
- Fork 3 part 3 (converter): reply is returned inside the webhook HTTP response (no sendMessage round trip); server-side time measured 0.65–1.15s incl. short links and mixed messages. Bare links typed without http (Telegram "url" entities) are converted. Mixed messages: convertible shop links converted, everything else (other links + text) untouched; failed shop links reported in a follow-up message. Non-shop pages get one quick attempt, capped at 1.8s, no backup chain. cleanLink(url, fast) fast mode for bot only.
- Verified live: EarnKaro token valid (Myntra, Ajio convert; Flipkart/Amazon "seller not available" on EarnKaro). Sankmo saved token (32 chars) rejected by Sankmo: "Invalid Token!" — user must regenerate and paste again.
- Simulated-webhook test helper pattern: POST localhost:3000/api/public/telegram/converter with x-telegram-bot-api-secret-token = HMAC-SHA256(SESSION_SECRET, "telegram-converter:"+bot token); success replies are not sent to Telegram (they are in the HTTP response). Vitest 59/59.
- Fork 3 part 4: bot now REMOVES links that are not converted (non-shop links and failed shop links such as Amazon); a line holding only such a link is dropped; normal text untouched; hidden text_link entities for those are dropped. Follow-up message lists removed failed shop links. Vitest 59/59.
- Twitter/X API not built: needs a paid official X API plan or a third-party scraper key (user to decide).
- Moving to another Emergent account: Save to GitHub -> Import from GitHub; DB data and secrets do not transfer automatically.

## 2026-11-20 (fork) — Sankmo bot, converter order, feed backups + X API
- Converter order setting `converter_order` (default ExtraPe → EarnKaro → Sankmo), admin "Converter order" panel. Amazon skips Sankmo. Explicit per-store route goes first.
- Sankmo via @sankmo_bot (gramjs userbot): `src/server/sankmo-bot.server.ts`, admin endpoints `/sankmo-bot/{status,send-code,verify,disconnect}`; session stored in settings.tg_session (never sent to browser). Env: TELEGRAM_API_ID, TELEGRAM_API_HASH. User must still log in (phone + code) in admin.
- Feed backups: `src/server/x-feed.server.ts` — main → up to 5 custom backup RSS → 5 auto Nitter mirrors → X API (X_BEARER_TOKEN, max once/30 min per account, since_id). New source kind "x". Source fields backup_urls, x_username, last_via. `/x/test` endpoint + UI.
- Sankmo token API returns "Invalid Token!" (token API not usable). X_BEARER_TOKEN saved is a 40-char value → X returns 401; needs the app Bearer Token (~110 chars, starts with AAAA).
- Backlog: admin Telegram alert when converter keys expire (P1); social-link ingest filter (P2); converter-logs NaN limit (P2).
- 2026-11-20: X backup switched to spare-account login cookies (X_AUTH_TOKEN + X_CT0) via @the-convocation/twitter-scraper; official X_BEARER_TOKEN only used if it starts with "AAAA" (the saved X_BEARER_TOKEN is the user's main-account cookie and is ignored). Throttled reads return [] (no error). Verified: 5–7 live posts read in ~1s.
- 2026-11-20: Expired-key Telegram alerts (ExtraPe/EarnKaro/Sankmo/X cookies, once per 6h each, also fire when a backup converter succeeds). /start hint reply, "Radhe Radhe" accepted. Webhook health check no longer steals the bot from another site copy unless that copy is failing (404/5xx). /Radhe no reply root cause: preview URL slept → Telegram got 404. Fix: deploy and press Connect bot on the live site.

## 2026-06 session — deployment
- Fork lacked backend/.env, frontend/.env and root node_modules (preview frontend FATAL). Recreated env files (MONGO_URL, DB_NAME=dealloot_preview, NODE_INTERNAL_URL=http://127.0.0.1:3000, ADMIN_PASSWORD user-chosen, SESSION_SECRET generated), ran root yarn install. Preview + production build verified.
- EXTRAPE_SESSION_SECRET (ExtraPe accessToken cookie) re-added via secure card; LIVE Flipkart conversion verified (fkrt.co).
- Deployment readiness passed; first Emergent deploy dispatched (requested subdomain dealloot.emergent.host). Custom .in/.com domain not yet bought.
- DB has 0 sources/deals — user to provide source list.
## Backlog
- P0: add user's sources; connect purchased custom domain (dealloot.in) after deploy.
- P1: Telegram destinations; scheduled scan cron.
- Emergent deploy FAILED: platform runtime cannot run the Node SSR server (RCA in /app/deployer-agent-docs). Options offered: Render free (recommended, render.yaml ready) vs rewrite to Python. Awaiting user choice.
- Added user's 38 sources (25 Telegram, 10 RSS, 3 web) to preview DB; test-all: 35 ok, desidime web x2 HTTP403, dealsmagnet web page empty.
- Added Telegram /status command (statusReport in telegram-converter.server.ts, testConverterKeys in engine.server.ts): live key check + feed health. Verified via SSR module run. ExtraPe expiry alert already existed (KEY_ALERTS); both need converter bot token set in Control Room (not set yet).
- LIVE on Render: https://dealloot.onrender.com (user's existing Mongo data: 40 sources, 109 deals, converter bot @earnadobot webhook on current URL). Read-only live test iteration_8: all pages/admin tabs OK.
- FIXED (preview, needs GitHub push + Render redeploy): ExtraPe cut URLs at '+'/space → broken myntr.in/ajiio.co links (18/109 live). Query now encoded when it has +/%20; broken short links rejected. iteration_9 5/5 pass. After deploy: Control Room → Reconvert (last 24h).
- Backlog: expiring Telegram CDN images (47/109 cards no image) → proxy/store images; paginate admin Deals tab; 404 page styling.
- Cron: cron-job.org POST /api/public/cron/tick, header Authorization: Bearer CRON_SECRET, every 5 min.

## 2026-06 — Offers tab, affiliate page layout (user review pending, testing agent NOT yet run)
- New category `offer` ("Offers & coupons" filter on home). Paytm/Swiggy/Zomato/Woohoo/Gyftr (engine OFFER_STORES) are never converted and always classified `offer`; any post with no product price + offer wording (coupon/code/bank offer/cashback/upto %/sale) is also `offer`. Offer posts are excluded from all other public listings.
- Those 5 stores removed from Store Routes and sample checks.
- Affiliate Setup split into 3 sub-tabs: Keys & logins / Order & stores / Telegram bot (data-testid affiliate-subtab-*).
- Bot /tweets is now OFF by default (user asked to leave X-in-Telegram alone); switch remains in Telegram bot sub-tab.
- Live ExtraPe sample results (preview): OK Flipkart, Myntra, Ajio, Shopsy, Tata CLiQ, JioMart, Nykaa; not supported Amazon, Meesho, Croma, Xiaomi, Snapdeal, Reliance Digital. EarnKaro/Sankmo not configured in preview, so untested.
- vitest 121/121, tsc clean. Pending: user OK, then testing agent for combined old+new flows.

## 2026-06 — Combined testing (iteration_10)
- Testing agent iteration_10: 18/18 API tests, frontend flows pass, vitest 121/121, tsc clean. No bugs found.
- NOT covered in preview (not configured there): EarnKaro + Sankmo live conversion, real Telegram send (no bot token/destination in preview DB), cron tick 202 path (WEBHOOK_CRON_SECRET missing in preview backend/.env), real offer-category deal from a live import (0 offers in preview DB).
- Preview DB has overrides affiliate_chains Flipkart/Tata CLiQ = [earnkaro, sankmo] (no tokens) so Flipkart does not convert in preview until tokens are added or route reset.
- Next: user pushes to GitHub -> Render redeploy; then on live: add EarnKaro token + Sankmo login in Keys & logins, run Check store samples, send one Telegram test post, Reconvert last 24h.
- Backlog: derive Store Routes list from engine OFFER_STORES (P2); narrow OFFER_RE if product posts get mis-filed as offers (P2); image proxy for expiring Telegram CDN images (P1); custom domain guidance (P1).

## 2026-06 — Deal Image Saver
- `src/server/deal-images.server.ts`: on ingest (background) and after every scan (backfill, 25 recent deals), deal picture is downloaded, shrunk with sharp to max 480px WebP and stored in Mongo `deal_images` (TTL index 7 days — user choice). Deal gets `image_saved_at`; original `image` URL is kept (Telegram sendPhoto still uses it).
- Public list returns `/api/public/img/<dealId>` while the copy exists (cache 7 days, immutable), else original URL. DealCard shows the store-letter placeholder if a picture fails to load.
- Verified: fixture deal saved (1200x900 jpg -> 480x360 webp ~4KB), served 200, card rendered on mobile; vitest 121/121, tsc clean, production build bundles sharp. NOT verified: a real source import end-to-end (testing agent not run for this feature); Render build with sharp.
- Custom domain steps (Render -> Settings -> Custom Domains, DNS at registrar, update public URL env, reconnect bot, update cron-job.org URL) explained to user; domain not bought yet.

## 2026-06 — Live Telegram issues (Render)
- Sankmo panel on Render showed "API ID & API Hash missing" while "Connected as <user>": TELEGRAM_API_ID / TELEGRAM_API_HASH were never set on Render (render.yaml did not list them); the saved login comes from the shared DB. Added TELEGRAM_API_ID, TELEGRAM_API_HASH, X_AUTH_TOKEN, X_CT0 to render.yaml (sync:false) — user must enter values in Render → Environment.
- Sankmo panel: new "Test Sankmo" button (POST /api/public/sankmo-bot/test, converts a sample Flipkart link, 3/min); amber warning when a login exists but API creds are missing; clearer Disconnect confirm (does not affect converter bot).
- Intermittent "Telegram could not be reached": telegramCall now retries 3x (12s timeout each) and logs the network error code; start-production.mjs sets dns ipv4first + autoSelectFamily attempt timeout 2500ms. Root cause on Render NOT confirmed (no access to Render logs) — after redeploy check Render logs for "Telegram network error".
- Verified in preview: tsc clean, vitest 121/121, /sankmo-bot/test returns clear error when not logged in. NOT verified: Test Sankmo with a real login, behaviour on Render.
- Scan interval setting: Rules tab "Check for deals every" select (1/3/5/10/15/30 min, 1h, 2h → check_interval_seconds, min now 60). /cron/tick skips the scan (202, skipped:true) until the chosen gap since last_run_at has passed (20s slack); "Fetch now" and /cron/fetch are not gated. For gaps under 5 min the external scheduler (cron-job.org) must ping every 1 minute. Verified: setting save/clamp, dropdown on mobile, tsc, vitest 121/121, production build. NOT run in preview: the tick skip path with a valid cron secret (none configured in preview).

## 2026-06 — Scan status, admin-only refresh, dark mode
- `GET /api/public/scan-status` (admin only): last_scan_at, next_scan_at, running, latest_deal_at (latest fetched deal), fetched_4h. `ScanStatus.tsx` shown on admin Deals tab (4 cells) and compact under the interval select in Rules. Shows "Overdue" if no ping arrived 2 min past the expected time.
- Home "Refresh" button now shown only when admin is signed in.
- Dark / normal mode: toggle in navbar (data-testid theme-toggle-button) for every visitor, saved per browser in localStorage `dealloot-theme`, default light; `.dark` on <html> set by an inline head script; colours remapped in `src/styles.css` (html.dark overrides of the fixed light utility classes) — new colour classes need a matching override there.
- Star is admin-only: puts the deal in Best deals / Editor's picks and keeps it visible past the age limit.
- Verified by screenshots (desktop + 390px, no overflow), API curl, tsc, vitest 121/121. Testing agent NOT run. Full live check on Render still pending (user has not deployed yet).

## 2026-06 — Grouped Telegram post, unresolved links, source privacy
- Multi-link source post: still split into separate website deals, but Telegram gets ONE message (`engine.formatGroupMessage`, `postDeal(deal, null, group)`, one post-log row, one post budget). Covered by src/test/group-message.test.ts; NOT exercised against a live channel.
- `link_unresolved` deals (final link is still a deal site / foreign short link) are saved as draft, never auto-posted, blocked from publish in saveReview; admin Deals tab has a "Needs link" filter.
- Public /deals no longer returns source, source_id, source_post_url, text, url, post_title.
- Sankmo status returns `credentials_problem` (which env var is missing/malformed, never the value); env values tolerate quotes/spaces. User had NOT added TELEGRAM_API_ID/HASH on Render.
- ScanStatus also on home page for admin. Dark mode text contrast raised.

## 2026-06 — Per-channel repeat check, link hygiene, grouped resend, dark-mode fixes (fork 3)
- Converter bot: same product (engine.productKey of the cleaned link) is checked PER CHAT in Mongo `converter_products` (_id `<bot>:<chat>:<productKey>`, atomic upsert). Repeat inside `converter_repeat_minutes` (default 5 min; select 5/10/15/20/30/60 min, user choice, in Affiliate Setup → Telegram bot): channel post is deleted (needs "Delete messages" right, else converted as usual); group = no reply; private chat never checked. Logged in Converter History as status `repeat`. One extra DB round trip after conversion.
- Link hygiene: stripAffiliate drops utm_/af_/aff*/AppsFlyer pid+c etc. and normalises dl.flipkart.com; unknown shorteners (rb.gy, indfs.in, fkrtt.in, short host + code path) count as short links → draft "Needs link" instead of published "Normal link". Admin review list shows the stripped link for unconverted deals.
- One source post → one Telegram message also for "Send recent" and when a later link of the post fails mid-scan.
- Dark mode: contrast audit of all admin tabs/home/guides passed 4.5:1 for normal text; fixed washed-out disabled buttons (opacity .78) and price-chart axis/tooltip colours.
- Verified: tsc clean, vitest 128/128 (2 suites need a backend/.env — absent in this fork; run with a temporary file), real-Mongo check of the claim logic, production build OK. NOT verified: live Telegram channel (delete/edit against real Telegram), Render.
- Fork note: backend/.env and frontend/.env are missing in this fork and platform secrets are empty, so the Emergent preview (supervisor frontend/backend) does not start. Checks were run with a temporary local server.
- Open: exact cause of "7 separate posts" not reproduced; ask user for one example source post + which screen (Telegram channel or website) if it still happens after deploy.

## 2026-06 — Live repeat-check diagnosis and converter fixes (fork 3, round 3)
- Read-only check of live Converter History (dealloot.onrender.com) showed: (1) same Flipkart product arrives as `?lid=` only, `?pid=&lid=` and `&marketplace=` shapes → different product keys → repeat missed; (2) links the bot made in the private chat are re-posted to channels and were converted a second time.
- Fixes: productKey derives the Flipkart PID from `lid` (LST + 16 chars); links found in converter_logs.converted are treated as own (no second conversion, known clean link used for the repeat key; index on `converted`); anonymous-admin / post-as-channel group messages (from.is_bot + sender_chat) are no longer ignored; chat schema keeps title.
- New: Converter History shows chat name/type, converter used ("via ExtraPe") and "already your link"; setting `converter_bot_service` (auto/extrape/earnkaro/sankmo = tried first, others backup) in Telegram bot panel; `/style label|link` in the private chat switches `converter_label_style`; connected chats show names.
- Website: same product+price saved by two sources at the same moment is now blocked atomically (`seen` key `p:<product_key>:<price>:<date>`); Review queue has "Remove duplicate deals" (POST /deals/remove-duplicates; keeps first copy, 2-day window, never deletes featured).
- Verified: tsc clean, vitest 135/135 (with temporary backend/.env), remover checked on real local Mongo, production build OK, UI smoke test. NOT verified: real Telegram, Render; cause of "no reply to /radhe in group" not confirmed (no group is connected on live; likely BotFather privacy mode or anonymous admin).
- Round 4: hourly automatic duplicate clean-up (runs from /cron/tick, gated once per hour via `converter_alerts` _id `dedupe-hourly`). Webhook no longer answers 500 for posts Telegram permanently refuses (4xx except 429, >10 links, too long): marked done, logged as failed in Converter History, so Telegram stops re-sending and blocking later posts (live showed "Wrong response from the webhook: 500", pending 2 — exact failing post not identified, no access to Render logs). vitest 137/137, build OK. Live sources checked: hotdealsbywd / Flipkart_scdeals_PranayCC / tapworthy are NOT yet in Sources.

## 2026-06 — Faster converter, plan/plan.md Phase 1 (fork 3, round 5)
- Built Phase 1: repeat check before conversion; repeat delete returned inside the webhook answer (`{method:"deleteMessage"}`, no confirmation from Telegram); 24 h link memory in Mongo `converter_memory` (TTL on `exp`; `c:` listing → affiliate link, `s:` short link → clean link, `o:` bot-made link → clean link, 30 days) with an in-process map in front; settings + connected chats cached in memory (60 s TTL, cleared by core.updateSettings → `settingsChanged`, which also drops `c:` entries when a converter key/route really changed); update lock runs in parallel with link cleaning; timing fields on logs (`deliver_ms`, `open_ms`, `service_ms`, `telegram_ms`, `total_ms`) and averages in Converter History.
- Deviation from plan wording (deliberate): reuse key is the Flipkart seller listing (pid + lid), not the bare product, because the owner's SuperCoin posts depend on the seller. Repeat check is still by product (PID) per chat.
- Owner's script deletes its own channel post if it is not converted within 2 s (this caused "message to edit not found"). New: when the edit fails because the post is gone and the post is < 10 min old, the bot posts the converted message as a new post (text, or photo/video/animation/document by file_id). Logged with `reposted: true`.
- Not built (owner's decision): Phase 2 "post once, bot publishes"; posting full links instead of short links. Phase 3 (hosting/region/fastest mode) waits for measured numbers.
- affiliate.server split into cleanAffiliate / finishAffiliate / findLinks / renderConverted (convertAffiliate and convertAffiliateText keep their behaviour).
- Verified: tsc clean, vitest 151/151 (temporary backend/.env), real local Mongo run of memory/claims/settings invalidation, production build OK, UI smoke test. NOT verified: real Telegram, Render, actual speed gain (no live numbers yet).

## 2026-06 — Private Channel Reader (planning, NOT built yet)
- Settings file: `config/private-reader.json` (tracked in Git): sources hotdealsbywd, tapworthy, Flipkart_scdeals_PranayCC; destinations https://t.me/dealfetch, https://t.me/Deltfetch; caption_position "top"; caption empty (user will send tomorrow).
- Spare-account TELEGRAM_API_ID / TELEGRAM_API_HASH requested via secure card -> backend/.env (gitignored, not pushed). On Render they must be added in service Environment (render.yaml already lists both, sync:false).
- OTP is never stored. Existing gramjs login (sankmo-bot.server.ts, admin phone+code) saves encrypted session in Mongo settings.tg_session — survives redeploys; must log in on the LIVE site (live Mongo differs from preview DB).
- User will upload their existing local script tomorrow for reference before building. Render free tier sleeps -> always-on plan needed for reader.
- 2026-06: TELEGRAM_API_ID + TELEGRAM_API_HASH saved via secure card (platform-injected env, both formats valid). Admin /sankmo-bot/status -> credentials_ready true, connected false (no OTP login done yet).
- Fork again lacked backend/.env + frontend/.env (frontend FATAL "MONGO_URL is not set"). Recreated: MONGO_URL, DB_NAME=dealloot_preview, NODE_INTERNAL_URL, ADMIN_PASSWORD (test_credentials.md), generated SESSION_SECRET + WEBHOOK_CRON_SECRET, CORS_ORIGINS; frontend REACT_APP_BACKEND_URL. Preview back up (stats 200).
- Next: user uploads their existing local script, sends caption text; then build reader.
