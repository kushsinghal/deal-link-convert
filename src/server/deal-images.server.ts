// @ts-nocheck — keeps a small copy of each deal picture for 7 days so cards survive expiring source links
import { mongo } from "./db.server";
import { UA } from "./engine.server";

export const IMAGE_KEEP_MS = 7 * 86400e3;
const PRIVATE_HOST = /\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[)/;

export const savedImageUrl = (deal: any) =>
  deal.image_saved_at && Date.now() - Date.parse(deal.image_saved_at) < IMAGE_KEEP_MS - 3600e3 ? `/api/public/img/${deal.id}` : deal.image;

async function shrink(buf: Buffer, ctype: string) {
  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(buf).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    return { data, ctype: "image/webp" };
  } catch {
    return buf.byteLength <= 400_000 ? { data: buf, ctype } : null;
  }
}

export async function saveDealImage(dealId: string, url: string | null) {
  if (!url?.startsWith("http") || PRIVATE_HOST.test(url)) return false;
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(12000) });
    const ctype = r.headers.get("content-type") || "";
    if (r.status !== 200 || !ctype.startsWith("image/")) return false;
    const raw = Buffer.from(await r.arrayBuffer());
    if (raw.byteLength > 8_000_000) return false;
    const out = await shrink(raw, ctype);
    if (!out) return false;
    const db = await mongo();
    const at = new Date();
    await db.collection("deal_images").updateOne({ id: dealId }, { $set: { id: dealId, data: out.data, ctype: out.ctype, created_at: at } }, { upsert: true });
    await db.collection("deals").updateOne({ id: dealId }, { $set: { image_saved_at: at.toISOString() } });
    return true;
  } catch (e) {
    console.warn("deal image save failed", dealId, e?.message);
    return false;
  }
}

/** Saves pictures for recent deals that do not have a stored copy yet. */
export async function saveMissingDealImages(limit = 25) {
  const db = await mongo();
  const since = new Date(Date.now() - 2 * 86400e3).toISOString();
  const rows = await db.collection("deals").find({ image: { $regex: "^http" }, image_saved_at: { $exists: false }, created_at: { $gte: since } })
    .project({ id: 1, image: 1 }).sort({ created_at: -1 }).limit(limit).toArray();
  let saved = 0;
  for (const d of rows) {
    if (await saveDealImage(d.id, d.image)) saved++;
    else await db.collection("deals").updateOne({ id: d.id }, { $set: { image_saved_at: null } });
  }
  return saved;
}

export async function serveDealImage(dealId: string) {
  const doc = await (await mongo()).collection("deal_images").findOne({ id: dealId });
  if (!doc) return new Response("Not found", { status: 404 });
  const data = doc.data?.buffer ?? doc.data;
  return new Response(data, { headers: { "content-type": doc.ctype, "cache-control": "public, max-age=604800, immutable" } });
}
