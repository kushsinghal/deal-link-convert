# DealLoot PRD
Original request: check the product, fix issues, and switch the link converter from EarnKaro to ExtraPe (EarnKaro not paying on Flipkart/Amazon).
User choices: ExtraPe; keep both with ExtraPe default; user has no ExtraPe token yet.

## Done (2026-06)
- ExtraPe converter (POST https://www.extrape.com/handler/convertText, accesstoken header/cookie) in src/server/engine.server.ts
- Default route for every store incl. Amazon = ExtraPe; EarnKaro auto backup when ExtraPe token missing/fails; Sankmo optional
- Affiliate Setup UI: ExtraPe token field + how-to, Amazon ExtraPe/EarnKaro choice, "Use ExtraPe for every store" button
- Fixed TS error in affiliate.server.ts; 43 unit tests pass; production build OK

## Backlog
- P0 user: add ExtraPe accessToken and test a real Flipkart/Amazon link
- P1 deploy on Render; verify Telegram delivery
