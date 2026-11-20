# DealLoot

React + TanStack Start + Nitro (Node), MongoDB, RSS/Atom and public Telegram source readers. No Supabase database is used by the server. Existing VITE_SUPABASE variables are legacy; they are not needed for this app.

## Two hosting layouts

### Emergent
- `frontend/package.json` starts the existing Node app on the platform's frontend port. `backend/server.py` forwards `/api/*` to it on the platform's API port. Both remain supervisor-managed.
- Frontend build: `yarn build` from `frontend` installs/builds the root app into `.output`.
- Configure `NODE_INTERNAL_URL` for the local Node service, `MONGO_URL`, `DB_NAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` and `REACT_APP_BACKEND_URL`. Production startup requires a private admin password (16+ characters) and session secret (32+ characters). Do not use preview credentials publicly.
- `EXTRAPE_SESSION_SECRET` is server-only, supplied through the secure secret manager. No tokens belong in React variables or GitHub.
- Changing the public URL requires rebuilding the frontend, because its API origin is a build-time variable. Production uses `NODE_ENV=production`; preview uses Vite.

### Render (one Node web service)
1. For a new clean repository, download `/downloads/dealloot-source.zip`, extract it, and upload its contents to GitHub. Link that repository in Render using **New → Blueprint** and `render.yaml`. The archive excludes all secrets and Git history. It can be regenerated with `python scripts/export-source.py`.
2. Supply `MONGO_URL` for your MongoDB database, `DB_NAME`, a private `ADMIN_PASSWORD` (16+ characters), and `EXTRAPE_SESSION_SECRET` through hosting secrets. Render generates `SESSION_SECRET` and `CRON_SECRET`.
3. Render supplies `PORT` and `RENDER_EXTERNAL_URL`. The build script uses that external URL for the browser API origin. For a custom domain, set the intended origin in the build script/environment configuration and rebuild; keep browser and API on the same origin.
4. MongoDB Atlas requires a database user with read/write access to the selected database and an IP access list that allows your hosting service's outbound IPs. Avoid opening Atlas to every IP when known egress addresses are available.
5. Build: `yarn install --frozen-lockfile --production=false && node scripts/build-production.mjs`.
6. Start: `node scripts/start-production.mjs`. Health check: `/api/public/stats`.

Do not deploy the Python adapter as a separate Render service. Node serves both the UI and API there. The clean source archive exports code, not source records, deals or secrets. If your original source list lives in another database, connect that database or re-enter the sources; this fork has no original source records. Never copy preview data into production without reviewing it.

**Existing Git history note:** the originally imported root `.env` is already tracked and contains obsolete browser-visible Supabase configuration. New ignore rules do not remove it from that history. Backend/frontend environment files and the new ExtraPe token are not tracked. Use the clean source archive for a new GitHub repository; if using **Save to GitHub** with the original history, review/remove that legacy configuration in GitHub before sharing it. No Git history has been rewritten by this update.

## Local configuration
Copy `.env.example` to `.env` and supply values. Install Node 22+ and Yarn, then `yarn install --frozen-lockfile`. Set the public API origin before building. `node scripts/build-production.mjs` produces a Node build; production startup is `node scripts/start-production.mjs`.

## Sources and editorial review
- **Control Room → Sources → Test / Test all** checks readability without importing, publishing or posting to Telegram. Results distinguish empty sources from failures. Public Telegram post URLs are normalized to channel usernames.
- **Import drafts** applies deal filters. An HTTP-success HTML page is not a valid RSS feed; malformed XML and unavailable Telegram previews show actionable errors. Some third-party sites block automatic readers; no access-control bypass is attempted.
- New sources have stable IDs. Legacy records lacking IDs are repaired when the source list is read.
- Imported, manually added and converted deals remain private drafts. **Deals → Review & edit** requires original buying advice and a rights/offer checklist before publication. Unpublishing returns a deal to drafts. Public listings, stats, deal redirects, original-post and price-history routes exclude drafts.
- Review publication does not send messages. Use the separate Post control on a published deal to send to configured Telegram destinations.
- Guides and site policies live in `src/lib/editorial.ts`. Review them for your actual practices and develop additional original content before applying to an affiliate programme.

## ExtraPe and EarnKaro
- ExtraPe is the default; EarnKaro remains the backup when a valid EarnKaro token is configured. Environment token takes precedence over a legacy database token.
- ExtraPe's endpoint is undocumented, not an officially supported public API. A successful HTTP response can still contain a business error. Encoded links are decoded; errors and unchanged links are never reported as conversion success.
- Amazon: ExtraPe requires its own Amazon approval or an Amazon Associates tag configured in ExtraPe. A token alone does not grant that eligibility. Retailer support and commissions are controlled by the providers, not DealLoot.
- No Amazon Associate status is claimed on the site. Once actually enrolled, add the required statement, "As an Amazon Associate I earn from qualifying purchases," and follow the programme's current rules. Approval is never guaranteed.
- See Amazon's application guidance: https://affiliate-program.amazon.in/help/node/topic/G8TW5AE9XL2VX9VM/ and operating agreement: https://affiliate-program.amazon.in/help/operating/agreement.

## Optional scheduled imports
No automatic scheduler is installed by this blueprint. A saved Rules interval is not a scheduler. An external scheduler can POST `/api/public/cron/fetch` with `Authorization: Bearer <CRON_SECRET>`; keep secrets out of URLs and logs. The endpoint waits for completion. Manual import works without a scheduler. New imports remain drafts. Hosting sleep/timeouts can affect scheduled runs; verify actual run results rather than assuming a configured schedule ran.

## Tests
`yarn test` runs Vitest parser/routing regressions using **MOCKED** provider responses. Real source health checks and an authenticated live converter test are separate: passing a unit test does not prove an external account is eligible or an earning link will generate commission.