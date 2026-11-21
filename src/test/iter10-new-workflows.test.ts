// Combined new workflows: isolated Mongo fixtures; all Telegram, GramJS, RSS and affiliate I/O MOCKED.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const gram = vi.hoisted(() => ({ failure: "", password: false, disconnects: 0 }));
vi.mock("telegram/sessions", () => ({ StringSession: class { constructor(public value: string) {} save() { return this.value || "TEST_private_session"; } } }));
vi.mock("telegram", () => {
  class SignIn { constructor(public value: any) {} }
  class AuthorizationSignUpRequired {}
  class LogOut {}
  return { Api: { auth: { SignIn, AuthorizationSignUpRequired, LogOut } }, TelegramClient: class {
    connected = true; session: any;
    constructor(session: any) { this.session = session; }
    setLogLevel() {} async connect() {} async disconnect() { gram.disconnects++; }
    async sendCode() { if (gram.failure) throw { errorMessage: gram.failure, seconds: gram.failure === "FLOOD_WAIT" ? 90 : undefined }; return { phoneCodeHash: "TEST_hash", isCodeViaApp: true }; }
    async invoke(action: any) { if (action instanceof LogOut) return true; if (gram.failure) throw { errorMessage: gram.failure }; if (gram.password) throw { errorMessage: "SESSION_PASSWORD_NEEDED" }; return { user: { firstName: "TEST_User" } }; }
    async signInWithPassword() { if (gram.failure) throw { errorMessage: gram.failure }; return { firstName: "TEST_User" }; }
  } };
});
const env = Object.fromEntries(readFileSync("/app/backend/.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0,l.indexOf("=")), l.slice(l.indexOf("=")+1).replace(/^"|"$/g, "")]));
process.env["MONGO_URL"] ||= env["MONGO_URL"];
process.env["DB_NAME"] = `dealloot_TEST_${randomUUID().replaceAll("-", "")}`;
process.env["SESSION_SECRET"] = "TEST_only_storage_key_not_production";
process.env["TELEGRAM_API_ID"] = "12345";
process.env["TELEGRAM_API_HASH"] = "a".repeat(32);
delete process.env["EXTRAPE_SESSION_SECRET"];
delete process.env["X_AUTH_TOKEN"]; delete process.env["X_CT0"]; delete process.env["X_BEARER_TOKEN"];
let db: any, core: any, bot: any, feeds: any, engine: any, conv: any;
const TOKEN = "998877:" + "x".repeat(30);
const sent: any[] = [];
const tracked = new Map<string, Set<any>>();
async function insert(col: string, row: any) { const out = await db.collection(col).insertOne(row); const ids = tracked.get(col) || new Set(); ids.add(out.insertedId); tracked.set(col, ids); return row; }
beforeAll(async () => {
  db = await (await import("@/server/db.server")).mongo();
  core = await import("@/server/core.server"); bot = await import("@/server/sankmo-bot.server"); feeds = await import("@/server/x-feed.server"); engine = await import("@/server/engine.server"); conv = await import("@/server/telegram-converter.server");
  await insert("settings", { id: "main", telegram_converter_token: TOKEN });
  await insert("telegram_converter_chats", { _id: "998877:TEST_owner", bot: "998877", chat_id: "TEST_owner", type: "private" });
});
beforeEach(async () => {
  gram.failure = ""; gram.password = false; sent.length = 0;
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    if (!String(input).startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw new Error("TEST blocked unexpected external I/O");
    sent.push({ method: String(input).split("/").pop(), ...JSON.parse(init?.body || "{}") });
    return Response.json({ ok: true, result: true });
  }));
});
afterAll(async () => {
  // Every cleanup is bounded to records owned by this suite in its random isolated database.
  for (const [col, ids] of tracked) await db.collection(col).deleteMany({ _id: { $in: [...ids] } });
  for (const col of ["request_limits", "telegram_tweet_jobs", "converter_alerts", "telegram_login_pending", "x_display_cache", "x_users", "deal_votes"]) {
    const ids = (await db.collection(col).find({}, { projection: { _id: 1 } }).toArray()).map((r: any) => r._id);
    if (ids.length) await db.collection(col).deleteMany({ _id: { $in: ids } });
  }
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const source = async (id: string) => insert("sources", { id, name: id, kind: "x", value: "testhandle", backup_urls: ["https://test.example/feed"], enabled: false });
const item = (n = 12345) => ({ ext_id: String(n), text: "TEST tweet", links: [], posted_at: new Date().toISOString(), post_url: `https://x.com/testhandle/status/${n}` });
it("shared store routes override global order, reset and skip missing tokens", async () => {
  const { routeForStore } = await import("@/lib/affiliate-routing");
  const s = { converter_order: ["sankmo", "earnkaro", "extrape"], affiliate_chains: { Other: ["earnkaro", "extrape"] }, earnkaro_token: "TEST" };
  expect(routeForStore(s,"Other")).toEqual(["earnkaro","extrape"]);
  expect(routeForStore({ ...s, affiliate_chains: {} },"Other")).toEqual(s.converter_order);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: 1, data: "https://ekaro.in/TEST" })));
  expect(await engine.convertLink("https://retailer.example/item",s)).toBe("https://ekaro.in/TEST");
  const { convertAffiliateText } = await import("@/server/affiliate.server");
  expect((await convertAffiliateText("https://retailer.example/item",s)).items[0]!.converted).toBe("https://ekaro.in/TEST");
});
it("Amazon tag has exact host guards and own tag is preserved only on own route", async () => {
  const { convertAffiliate } = await import("@/server/affiliate.server");
  for (const host of ["amazon.in","www.amazon.in"]) expect(engine.amazonAffiliate(`https://${host}/dp/TEST?tag=other-21`,"TEST-21")).toContain("tag=TEST-21");
  for (const host of ["evilamazon.in","amazon.in.evil.test","amazon.com"]) expect(() => engine.amazonAffiliate(`https://${host}/dp/TEST`,"TEST-21")).toThrow();
  const url = "https://www.amazon.in/dp/TEST?tag=TEST-21";
  expect(await convertAffiliate(url,{ amazon_tag:"TEST-21", affiliate_chains:{ Amazon:["amazon"] } })).toMatchObject({ own:true, converted:url });
  expect(await convertAffiliate(url,{ amazon_tag:"TEST-21", affiliate_chains:{ Amazon:["original"] } })).toMatchObject({ cleaned:"https://www.amazon.in/dp/TEST", keep_clean:true });
});
it("failed sample support does not disable a store", async () => {
  vi.stubGlobal("fetch",vi.fn(async () => Response.json({convertedText:"https://fkrt.co/TEST"})));
  expect(await engine.convertLink("https://www.flipkart.com/item/p/itm123",{extrape_token:"TEST",store_support:{results:{Flipkart:{extrape:"unsupported"}}}})).toBe("https://fkrt.co/TEST");
});
it("source third consecutive failure alerts once then recovers", async () => {
  const src = await source("TEST_health");
  for (let i=1;i<=4;i++) { await core.trackSourceHealth(src,"TEST timeout"); expect(sent.length).toBe(i<3?0:1); }
  await core.trackSourceHealth(src,null); expect(sent).toHaveLength(2); expect(sent[1].text).toContain("working again");
  expect((await db.collection("sources").findOne({id:src.id})).fail_streak).toBe(0);
});
it("status chooses newest scan over old test health", async () => {
  await insert("sources",{id:"TEST_status",name:"TEST_status",enabled:true,last_fetched_at:"2026-11-20T12:00:00Z",last_error:"TEST_new_error",health:{checked_at:"2026-11-20T10:00:00Z",status:"ok"}});
  vi.spyOn(engine,"testConverterKeys").mockResolvedValue([]);
  expect(await conv.statusReport({})).toContain("TEST_new_error");
});
it("X normalization, generated RSS and valid backup preference persists next scan", async () => {
  const {normalizeSource} = await import("@/server/source-input.server");
  expect(normalizeSource("x","https://x.com/TESThandle")).toBe("testhandle"); expect(feeds.generatedRss("@TESThandle")).toBe("https://nitter.net/testhandle/rss");
  const src = await source("TEST_preferred"); const calls: string[]=[];
  vi.spyOn(engine,"fetchRss").mockImplementation(async (url: any) => { calls.push(url); if(url!==src.backup_urls[0]) throw new Error("TEST_timeout"); return [item()]; });
  expect((await feeds.fetchSourceItems(src)).items).toHaveLength(1);
  const saved=await db.collection("sources").findOne({id:src.id}); expect(saved.preferred_feed).toBe(src.backup_urls[0]); calls.length=0;
  await feeds.fetchSourceItems(saved); expect(calls).toEqual([src.backup_urls[0]]);
  calls.length=0; vi.spyOn(engine,"fetchRss").mockImplementation(async(url:any)=>{calls.push(url);if(url===src.backup_urls[0])throw new Error("TEST broken preferred");return [item()];});
  await feeds.fetchSourceItems(saved); expect(calls[0]).toBe(src.backup_urls[0]); expect((await db.collection("sources").findOne({id:src.id})).preferred_feed).toBe(feeds.generatedRss(src.value));
});
it("X cooldown returns cached snapshot instead of empty array and never since_id", async () => {
  await insert("x_users",{username:"testcool",last_at:new Date().toISOString(),items:[item()]});
  expect(await feeds.fetchX("testcool")).toEqual([expect.objectContaining({ext_id:"12345"})]);
  process.env["X_BEARER_TOKEN"]="AAAA_TEST";
  vi.stubGlobal("fetch",vi.fn(async(input:any)=>{expect(String(input)).not.toContain("since_id");return Response.json(String(input).includes("by/username")?{data:{id:"12345"}}:{data:[{id:"12345",text:"TEST"}]});}));
  expect(await feeds.fetchX("testsnapshot",true)).toHaveLength(1); delete process.env["X_BEARER_TOKEN"];
});
it("recent tweets return labelled stale cache on feed timeout", async () => {
  await insert("x_display_cache",{_id:"teststale",items:[item()],via:"TEST",fetched_at:new Date(Date.now()-10*60e3).toISOString()});
  vi.spyOn(engine,"fetchRss").mockRejectedValue(new Error("TEST timeout"));
  expect(await feeds.recentTweets("teststale",7)).toMatchObject({cached:true,stale:true,items:[expect.objectContaining({ext_id:"12345"})]});
});
it("public tweets acknowledge unsigned401 then serve unconnected default7 without subscription", async () => {
  vi.spyOn(engine,"fetchRss").mockResolvedValue(Array.from({length:7},(_,i)=>item(12345+i)));
  const body={update_id:100,message:{message_id:1,chat:{id:100,type:"private"},text:"/tweets @testpublic"}};
  expect((await conv.receiveConverter(new Request("https://test.example"),body)).status).toBe(401);
  const res=await conv.receiveConverter(new Request("https://test.example",{headers:{"x-telegram-bot-api-secret-token":conv.webhookSecret(TOKEN)}}),body);
  expect((await res.json()).text).toContain("Reading"); await conv.lastBackground;
  expect(sent[0].text).toContain("7 post(s)"); expect(sent[0].text).toContain("https://x.com/testpublic/status/12345");
  expect(await db.collection("sources").findOne({value:"testpublic"})).toBeNull();
  expect(await db.collection("deals").countDocuments({})).toBe(0);
  const repeat=await conv.receiveConverter(new Request("https://test.example",{headers:{"x-telegram-bot-api-secret-token":conv.webhookSecret(TOKEN)}}),body); expect(await repeat.json()).toEqual({ok:true});
});
it("tweet switches and invalid counts reject without fetching", async () => {
  const {startTweetCommand}=await import("@/server/tweet-command.server");
  const msg={chat:{id:201},text:"/tweets @testpublic 7"}; const send=vi.fn();
  expect((await startTweetCommand({bot_tweets_enabled:false},msg,201,false,send)).response).toMatchObject({text:expect.stringContaining("disabled")});
  expect((await startTweetCommand({bot_tweets_enabled:true,bot_tweets_public:false},msg,202,false,send)).response).toMatchObject({text:expect.stringContaining("connected chats only")});
  for (const text of ["/tweets @bad! 7","/tweets @test 8","/tweets @test 4"]) expect((await startTweetCommand({bot_tweets_enabled:true}, {...msg,text},203,false,send)).response).toMatchObject({text:expect.stringContaining("choose 5, 6 or 7")});
  expect(send).not.toHaveBeenCalled();
});
it("tweets chat limit3/min, partial count and bounded timestamped chunks", async () => {
  const {startTweetCommand,tweetMessages}=await import("@/server/tweet-command.server");
  vi.spyOn(feeds,"recentTweets").mockResolvedValue({username:"testlimit",items:[item()],fetched_at:"TEST timestamp",cached:false,stale:false});
  const send=vi.fn(async()=>{});
  for(let i=0;i<4;i++){const job=await startTweetCommand({bot_tweets_enabled:true,telegram_converter_token:TOKEN},{chat:{id:301},text:"/tweets @testlimit 5"},301+i,false,send);expect(job.response).toMatchObject({text:expect.stringContaining(i<3?"Reading":"request limit")});await job.task;}
  expect(send).toHaveBeenCalledTimes(3); expect(send.mock.calls[0]).toBeDefined();
  const chunks=tweetMessages({username:"test",items:Array.from({length:7},()=>({...item(),text:"x".repeat(3000)})),fetched_at:"TEST timestamp"});
  expect(chunks.every((c:string)=>c.length<=3900)).toBe(true); expect(chunks.join("")).toContain("TEST timestamp");
});
it("all menu commands are returned and menu sync never sets webhook", async () => {
  for(const cmd of ["start","help","menu"]){const res=await conv.receiveConverter(new Request("https://test.example",{headers:{"x-telegram-bot-api-secret-token":conv.webhookSecret(TOKEN)}}),{update_id:400,message:{message_id:1,chat:{id:400,type:"private"},text:`/${cmd}`}});expect((await res.json()).text).toContain("/tweets");}
  expect((await conv.syncBotMenu()).ok).toBe(true); expect(sent.map(s=>s.method)).toEqual(["setMyCommands","setChatMenuButton"]);
});
it("Sankmo validates phone, encrypted sendCode then persists two-step across requests", async () => {
  await expect(bot.sendLoginCode("bad")).rejects.toThrow("country code");
  expect(await bot.sendLoginCode("+919876543210")).toMatchObject({sent:true});
  const row=await db.collection("telegram_login_pending").findOne({_id:"sankmo"}); expect(row.state).toMatch(/^enc1:/); expect(row.state).not.toContain("919876543210");
  gram.password=true; expect(await bot.verifyLoginCode("12345")).toMatchObject({password_required:true});
  expect(await bot.botStatus()).toMatchObject({code_sent:true,password_required:true});
  expect(await bot.verifyLoginCode("","TEST_password")).toMatchObject({connected:true});
  expect((await db.collection("settings").findOne({id:"main"})).tg_session).toMatch(/^enc1:/);
  expect(await bot.botStatus()).toMatchObject({connected:true,code_sent:false}); expect(gram.disconnects).toBeGreaterThan(2);
});
it("Sankmo expired pending, bad code/password and flood errors never leak", async () => {
  // Refresh only the exact pending fixture owned by this suite; no real OTP.
  const {seal}=await import("@/server/private-storage.server");
  const put=async(password_required=false)=>db.collection("telegram_login_pending").updateOne({_id:"sankmo"},{$set:{state:seal(JSON.stringify({session:"TEST_session",phone:"+919876543210",hash:"TEST_hash",password_required})),expires_at:new Date(Date.now()+60000)}},{upsert:true});
  await put(); gram.failure="PHONE_CODE_INVALID"; await expect(bot.verifyLoginCode("12345")).rejects.toThrow("incorrect");
  await put(true); gram.failure="PASSWORD_HASH_INVALID"; await expect(bot.verifyLoginCode("","wrong")).rejects.toThrow("password is incorrect");
  await put(); gram.failure="PHONE_CODE_EXPIRED"; await expect(bot.verifyLoginCode("12345")).rejects.toThrow("expired"); expect((await bot.botStatus()).code_sent).toBe(false);
  await put(); await db.collection("telegram_login_pending").updateOne({_id:"sankmo"},{$set:{expires_at:new Date(0)}}); await expect(bot.verifyLoginCode("12345")).rejects.toThrow("first");
  // Clear only this suite's send-code limiter to exercise mocked FloodWait safely.
  const limits=await db.collection("request_limits").find({_id: /^sankmo-send-code/}).toArray(); for(const l of limits)await db.collection("request_limits").deleteOne({_id:l._id});
  gram.failure="FLOOD_WAIT"; await expect(bot.sendLoginCode("+919876543210")).rejects.toThrow("wait 90 seconds");
  gram.failure=""; await bot.disconnectBot(); expect(await bot.botStatus()).toMatchObject({connected:false,code_sent:false});
});
it("concurrent same voter up calls count once then change/remove persists", async () => {
  const deal=await insert("deals",{id:"TEST_vote",publication_status:"published",votes_up:0,votes_down:0,vote_score:0});
  await Promise.all(Array.from({length:8},()=>core.voteDeal(deal.id,{vote:"up",voter:"TEST-voter-123456789"},"TEST_ip")));
  expect((await db.collection("deals").findOne({id:deal.id})).votes_up).toBe(1);
  expect(await core.voteDeal(deal.id,{vote:"down",voter:"TEST-voter-123456789"},"TEST_ip")).toEqual({votes_up:0,votes_down:1,mine:"down"});
  expect(await core.voteDeal(deal.id,{vote:"none",voter:"TEST-voter-123456789"},"TEST_ip")).toEqual({votes_up:0,votes_down:0,mine:"none"});
});
it("voting drafts/missing404 invalid400 and repeated actions429", async () => {
  await insert("deals",{id:"TEST_draft",publication_status:"draft"});
  for(const id of ["TEST_draft","TEST_missing"]) await expect(core.voteDeal(id,{vote:"up",voter:"TEST-voter-123456789"},"TEST_limit_ip")).rejects.toMatchObject({status:404});
  await expect(core.voteDeal("TEST_vote",{vote:"bad",voter:"TEST-voter-123456789"},"TEST_limit_ip")).rejects.toMatchObject({status:400});
  for(let i=0;i<60;i++)await core.voteDeal("TEST_vote",{vote:"none",voter:"TEST-voter-123456789"},"TEST_limit_ip");
  await expect(core.voteDeal("TEST_vote",{vote:"none",voter:"TEST-voter-123456789"},"TEST_limit_ip")).rejects.toMatchObject({status:429});
});