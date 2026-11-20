# Preview access

- Control Room: `/admin` (password-only login; no username/email).
- Existing preview password: `preview123` (recovered from the previous preview process, not newly created).
- Local Mongo preview database: `dealloot_preview`; no original sources or deals are present in this fork.
- Do not use this preview password in production. Render requires a private ADMIN_PASSWORD and generated SESSION_SECRET.
- ExtraPe token: secure backend secret `EXTRAPE_SESSION_SECRET`. Never put its value in this document.
- Last verified 2026-11-20: password-only preview login passed curl/API and desktop/mobile browser checks. No credentials were changed or seeded in this session.
- Current preview URL is in `frontend/.env` under `REACT_APP_BACKEND_URL`; use that in future forks, not an older copied URL.