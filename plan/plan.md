# Faster Telegram Conversion and Repeat Deletion

The Telegram converter bot converts new posts and removes repeat posts with fewer waits in between.
Converter History shows where each second goes, so later speed decisions rest on measured numbers.

## Who it's for

The DealLoot owner, who posts deals into connected Telegram channels and groups and wants each post converted, and each repeat gone, as quickly as possible.

## Where the time goes today

One bot serving several channels is not the cause. Each post is handled on its own, and a second bot would wait on the same services. The time is a chain of waits, one after another:

1. Telegram delivers the post to the site, and the site reads its settings, the connected-chat list and a per-post lock from the database (four separate database trips). Together this took about one second in the live history read on 22 Nov.
2. Each link is looked up in the database to see whether the bot made it earlier. Short links (fkrt.cc, amzn.to and similar) are opened to find the real product page.
3. The converter (ExtraPe, EarnKaro or Sankmo) is asked for the affiliate link. This is a wait on their servers.
4. The repeat check runs (one database trip). Today it runs after step 3, so a repeat post pays for a full conversion and is only then deleted.
5. In a channel, the bot asks Telegram to edit or delete the post and waits for Telegram's answer. In private chats and groups the reply already travels inside the site's answer.
6. One more database write, then the site answers Telegram.

Every Converter History entry already shows its total as "took X s". Those totals were not read during planning, and the converter's own share is not recorded yet.

One possible contributor could not be measured: the same small server also runs the website and scans 37 sources every 3 minutes. A post that arrives during a scan may be slowed.

## Core features and experience

**1. Repeat check before conversion**
- A repeat is recognised as soon as the link is cleaned, before the converter is called.
- A repeat post is deleted without any conversion. The converter wait disappears completely for repeats.
- If the first post of a product fails to convert, it does not count as posted, so a repost inside the window is still converted.

**2. Delete handed to Telegram without waiting (chosen)**
- Today the bot sends Telegram a separate delete request and waits for the reply "done" or "refused". That reply is the confirmation.
- After the change, the delete instruction travels back inside the answer the site already owes Telegram for the post. Telegram carries it out but never reports the result.
- This saves one full trip between the site and Telegram on every repeat.
- Cost: if Telegram refuses the delete, the repeat stays in the channel unconverted and Converter History still says "repeat". The earlier safety net (convert the post when the delete is refused) no longer applies in channels.

**3. Affiliate links reused for 24 hours (chosen)**
- When a product the bot converted in the last 24 hours comes again (in the other channel, in the private chat, or as a later repost), the bot uses the link it already made and skips the converter.
- Short links opened in the last 24 hours are remembered as well, so the same short link is not opened twice.
- Effect: the converter wait is removed for every product seen in the last 24 hours. A product seen for the first time still waits for the converter.
- Converter History marks these entries "reused link".
- The repeat rule is unchanged: same product in the same channel inside the repeat window is deleted; after the window it is converted at once from the remembered link.

**4. Fewer database trips per post**
- The site keeps the settings and the connected-chat list in memory instead of re-reading them for every post.
- Changes saved in Control Room or by a bot command still apply immediately.

**5. Timing breakdown in Converter History**
- Each entry shows three numbers: delivery, converter wait, and total.
- A summary line at the top shows the average for recent conversions and for recent deletes.
- For a handed-off delete, the time ends when the site answers Telegram. The moment the post actually disappears cannot be measured.

**Not changed in this phase**
- Editing a converted channel post still waits for Telegram's answer. A failed edit (like the four posts on 22 Nov) stays visible as "failed" instead of being recorded as converted.
- The first conversion of a brand-new product still depends on the converter company's speed.

**Setup changes outside the app (owner's actions, not part of the build)**
- Keep the site awake. Render's free plan puts a site to sleep after 15 minutes without incoming requests and takes about one minute to wake. An earlier setup step arranged an outside 1-minute ping to prevent this. The live site scanned its sources on schedule on 22 Nov, which fits that ping running, but it was not confirmed directly. Render's always-on instance costs $7 per month and has a 0.5 CPU share.
- Post full store links, or links the bot already made, instead of other people's short links. Short links must be opened first.
- Keep the database in the same region as the site (Singapore). The database's location could not be seen during planning.
- Region. The site is in Singapore; Telegram's bot servers are mainly in Amsterdam. Render cannot move an existing service; a new one must be created. This is not recommended until the timing breakdown shows that Telegram trips are the large part, because moving closer to Telegram may move the site further from the converters and the database.

## User flow

1. A deal is posted in a connected channel.
2. New product: the bot converts it and edits the post, with fewer waits than today.
3. Product seen in the last 24 hours: the post is edited without waiting for the converter.
4. Same product in the same channel inside the repeat window: the post is deleted straight away, with no conversion.
5. Converter History shows the time taken for each post, the split, and the recent averages.

Groups and the private chat follow the same rules as today: the bot stays silent on a repeat in a group, and the private chat is never checked for repeats. Link reuse applies in all of them.

## UI/UX feel

- No new screens. Converter History and the Telegram bot panel keep their current look.
- The timing numbers are small text on each entry, with one summary line at the top.
- Readable on a phone and in dark mode with the same contrast as the rest of Control Room.

## Implementation phases

**Phase 1 — MVP (built now)**
- Repeat check before conversion.
- Delete handed to Telegram without waiting.
- 24-hour reuse of affiliate links and opened short links.
- Fewer database trips per post.
- Timing breakdown and averages in Converter History.

**Phase 2 — Post once, bot publishes**
- A deal is sent once to the bot's private chat. The bot converts it once and posts the finished message into each chosen channel.
- Posts appear already converted. Nothing is edited or deleted afterwards, and the same deal cannot arrive twice.
- This is the largest drop available, because the moment in which a post sits unconverted in the channel disappears.

**Phase 3 — Hosting and fastest mode, decided from the measured numbers**
- A separate always-on service for the bot only, so website scans cannot slow it.
- A region decision based on the phase 1 breakdown.
- An optional "fastest mode" that also hands channel edits to Telegram without waiting, at the cost of failed edits no longer being recorded.

## Assumptions

- The repeat window stays as agreed: 5 minutes by default, with choices of 5, 10, 15, 20, 30 minutes and 1 hour, checked per channel or group.
- A post is deleted as a repeat only when every product link in it is a repeat.
- The reuse memory is shared by all connected chats, including the private chat.
- A remembered link lasts 24 hours from when it was made. Reusing it does not extend the time.
- Products without a recognisable product number (search pages, category pages, other stores) are matched by the exact clean link.
- Saving any change to the converter choice, store order or converter keys clears the remembered links.
- Failed conversions are never remembered.
- Channel edits keep waiting for Telegram's answer in this phase.
- No speed figure is promised. The numbers after deployment come from the timing breakdown.
- Totals are counted from Telegram's own timestamp on the post, which is in whole seconds, so any total can be off by up to one second.
- Telegram's documentation states that an instruction sent inside the answer returns no result. The app already answers private-chat and group messages this way.
- No paid hosting change, region move or second service is part of this build.
- How posts reach the channels today (by hand or through a forwarding tool) was not confirmed. Phase 2 assumes deals can be sent to the bot instead.
