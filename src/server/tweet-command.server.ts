import { mongo } from "./db.server";
import { recentTweets } from "./x-feed.server";
import { takeRateLimit } from "./rate-limit.server";

export function tweetMessages(result: any) {
  const header = `@${result.username} · ${result.items.length} post(s)\n${result.stale ? "Older cached posts — live fetch unavailable" : result.cached ? "Cached snapshot" : "Recent posts"} · ${result.fetched_at}\n`;
  const chunks: string[] = [];
  let text = header;
  result.items.forEach((it: any, index: number) => {
    const id = /(?:status\/)?(\d{5,25})$/.exec(String(it.ext_id))?.[1] || /status\/(\d{5,25})/.exec(it.post_url || "")?.[1];
    const url = id ? `https://x.com/${result.username}/status/${id}` : "";
    const post = `\n${index + 1}. ${String(it.text || "").slice(0, 1800)}${String(it.text || "").length > 1800 ? "…" : ""}\n${it.posted_at || "Date unavailable"}\n${url}\n`;
    if (text.length + post.length > 3900) { chunks.push(text); text = ""; }
    text += post;
  });
  if (!result.items.length) text += "\nNo public posts were returned.";
  if (text) chunks.push(text);
  return chunks;
}

let active = 0;
export async function startTweetCommand(settings: any, msg: any, updateId: number, connected: boolean, send: (text: string) => Promise<unknown>) {
  const reply = (text: string) => ({ response: { method: "sendMessage", chat_id: msg.chat.id, text }, task: Promise.resolve() });
  if (settings.bot_tweets_enabled !== true) return reply("Tweet lookup is currently disabled by the bot owner.");
  if (settings.bot_tweets_public === false && !connected) return reply("Tweet lookup is available to connected chats only.");
  const match = String(msg.text || "").trim().match(/^\/tweets(?:@\w+)?\s+(@?[A-Za-z0-9_]{1,15})(?:\s+([5-7]))?$/i);
  if (!match) return reply("Use /tweets @handle 7 (choose 5, 6 or 7). Public accounts only.");
  const db = await mongo(), jobs = db.collection("telegram_tweet_jobs");
  const key = `${settings.telegram_converter_token.split(":")[0]}:${updateId}`;
  try { await jobs.insertOne({ _id: key as any, status: "processing", expires_at: new Date(Date.now() + 86400e3) }); }
  catch (e: any) { if (e.code === 11000) return { response: { ok: true }, task: Promise.resolve() }; throw e; }
  const allowed = active < 2 && await takeRateLimit(`tweets-chat:${msg.chat.id}`, 3, 60e3) && await takeRateLimit("tweets-global-minute", 20, 60e3) && await takeRateLimit("tweets-global-hour", 60, 3600e3);
  if (!allowed) { await jobs.updateOne({ _id: key as any }, { $set: { status: "limited" } }); return reply("Tweet lookup is busy or its request limit was reached. Please try again later."); }
  active++;
  const task = (async () => {
    try {
      const result = await recentTweets(match[1]!, Number(match[2]) || settings.bot_tweets_count || 7);
      const messages = tweetMessages(result);
      for (let i = 0; i < messages.length; i++) {
        if (i) await new Promise(r => setTimeout(r, 1100));
        await send(messages[i]!);
      }
      await jobs.updateOne({ _id: key as any }, { $set: { status: "done", finished_at: new Date() } });
    } catch (e) {
      await jobs.updateOne({ _id: key as any }, { $set: { status: "failed", finished_at: new Date() } });
      await send("Could not read public posts for this handle right now. The feed may be unavailable, private or rate-limited. Try again later.").catch(() => {});
    } finally { active--; }
  })();
  return { response: { method: "sendMessage", chat_id: msg.chat.id, text: `Reading recent public posts for ${match[1]}…` }, task };
}