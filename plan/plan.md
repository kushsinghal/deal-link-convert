# DealLoot – Cron Setup (cron-job.org)

Ek free bahar ki service (cron-job.org) har 1 minute mein aapke live Render app ko "ping" karegi, taaki deals apne-aap fetch, convert aur Telegram par post hote rahein.
App ke andar jo interval aap chunte ho (1m, 3m, 5m, 10m, 30m, 1hr, 2hr), wahi asli speed decide karega – cron sirf app ko jagaye rakhta hai.

## Kiske liye
- DealLoot admin (aap), jo chahte hain ki deals bina manually button dabaye 24x7 auto chalein.

## Core features aur experience
- Ek simple step-by-step Hinglish guide: cron-job.org par account, naya job, URL, method, timing.
- Cron ka target link: `https://<aapka-render-domain>/api/public/cron/fetch`, method POST, har 1 minute.
- Check kiya jayega ki ye link cron-job.org se sahi chalta hai (agar POST/GET mein dikkat ho to app ko dono accept karne layak banaya jayega).
- Admin Deals page ka "Scan Status" (last scan, next scan, 4 ghante ke deals) se confirm hoga ki cron kaam kar raha hai.
- Admin panel mein koi naya Cron card nahi banega (aapki choice).

## User flow
1. Render par latest code deploy karein ("Save to GitHub" → Render auto-deploy).
2. cron-job.org par free account banayein → "Create cronjob".
3. URL daalein: `https://<render-domain>/api/public/cron/fetch`, schedule: Every 1 minute, Advanced mein Request method: POST.
4. Save → "Test run" dabayein → response 200 aana chahiye.
5. Admin panel → Deals → Scan Status mein "Last scan" update hota dikhe.
6. Speed badalni ho to admin settings mein interval badlein; cron ko 1 minute par hi rehne dein.

## UI/UX feel
- Koi naya screen nahi. Sirf guide + existing Scan Status se verification.

## Implementation phases
- **Phase 1 (MVP – abhi):** Cron endpoint ko cron-job.org ke saath compatible confirm karna (POST + GET dono par sahi response, fast reply taaki timeout na ho), aur aapko final Hinglish guide dena.
- **Phase 2:** Pending fixes – ek source post ke saare links ek hi Telegram post mein (7 duplicate band), Sankmo tab ka confusing "harsh code / API not configured" text hatana.
- **Phase 3:** Non-affiliate links (jaise dealshaven) ko clean store link mein badalna, na mile to Draft tab mein bhejna; dark mode ke colors/fonts behtar karna.

## Assumptions
- App Render par deployed hai aur public URL khula hai.
- Cron link par koi password/secret nahi lagaya jayega (abhi jaisa hai waisa); agar baad mein security chahiye to alag se add hoga.
- Render free plan so jaata hai – 1 minute ka cron use jagaye rakhega.
- Cron hamesha 1 minute par; asli fetch speed admin panel ke interval se control hogi.
- Telegram API ID/Hash Render env mein aap khud add kar chuke honge/karenge.
