import { mongo } from "./db.server";

export async function reviewDeals() {
  return (await mongo()).collection("deals").find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
}

export async function saveReview(id: string, body: any) {
  const title = String(body.title || "").trim();
  const editorial_note = String(body.editorial_note || "").trim();
  const publish = body.publish === true;
  if (publish && (title.length < 8 || title.length > 180)) throw new Error("Use a descriptive title between 8 and 180 characters.");
  if (editorial_note.length > 5000) throw new Error("Keep your review under 5,000 characters.");
  if (publish && (editorial_note.length < 80 || body.review_confirmed !== true)) throw new Error("Add at least 80 characters of original buying advice and confirm the review checklist before publishing.");
  const db = await mongo();
  if (publish && (await db.collection("deals").find({ id }, { projection: { _id: 0, link_unresolved: 1 } }).limit(1).toArray())[0]?.link_unresolved) throw new Error("This deal still points to another deal site. Add it again from Add Deal with the real store link.");
  const timestamp = new Date().toISOString();
  const result = await db.collection("deals").updateOne({ id }, { $set: { ...(body.title !== undefined ? { title } : {}), ...(body.editorial_note !== undefined ? { editorial_note } : {}), publication_status: publish ? "published" : "draft", reviewed_at: publish ? timestamp : null, published_at: publish ? timestamp : null } });
  if (result.matchedCount && publish) {
    const [deal] = await db.collection("deals").find({ id }, { projection: { _id: 0, product_key: 1, price: 1, mrp: 1, store: 1 } }).limit(1).toArray();
    if (deal?.product_key && typeof deal.price === "number" && deal.price > 0) {
      await db.collection("price_history").updateOne({ deal_id: id }, { $set: { deal_id: id, product_key: deal.product_key, price: deal.price, mrp: deal.mrp ?? null, store: deal.store, at: timestamp } }, { upsert: true });
    }
  }
  return result.matchedCount > 0;
}