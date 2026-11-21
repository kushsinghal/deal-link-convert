import { mongo } from "./db.server";

/** Persistent fixed-window counters count actions, including repeated toggles and failed requests. */
export async function takeRateLimit(key: string, limit: number, windowMs: number) {
  const col = (await mongo()).collection("request_limits");
  const bucket = Math.floor(Date.now() / windowMs);
  const row = await col.findOneAndUpdate({ _id: `${key}:${bucket}` as any }, {
    $inc: { count: 1 }, $set: { expires_at: new Date((bucket + 2) * windowMs) },
  }, { upsert: true, returnDocument: "after", projection: { _id: 0, count: 1 } });
  return (row?.count || 0) <= limit;
}