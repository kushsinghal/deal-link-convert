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
