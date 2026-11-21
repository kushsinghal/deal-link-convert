import { fetchSourceItems } from "./x-feed.server";
import { mongo } from "./db.server";
import { normalizeSource } from "./source-input.server";

export async function testSource(id: string) {
  const db = await mongo();
  const source = await db.collection("sources").findOne({ id }, { projection: { _id: 0 } });
  if (!source) return null;
  const checked_at = new Date().toISOString();
  const start = Date.now();
  let result;
  try {
    const value = normalizeSource(source.kind, source.value);
    const { items, via } = await fetchSourceItems({ ...source, value });
    const from = via ? ` (read via ${via})` : "";
    result = { status: items.length ? "ok" : "empty", posts: items.length, via, message: items.length ? `${items.length} posts readable${from}. No deals imported or sent.` : `Source loaded${from}, but no readable posts were found.`, checked_at, latency_ms: Date.now() - start };
  } catch (e) {
    result = { status: "error", posts: 0, message: String(e instanceof Error ? e.message : "Could not read source").slice(0, 300), checked_at, latency_ms: Date.now() - start };
  }
  await db.collection("sources").updateOne({ id }, { $set: { health: result } });
  return { id, name: source.name, ...result };
}

export async function testAllSources() {
  const sources = await (await mongo()).collection("sources").find({}, { projection: { _id: 0, id: 1 } }).limit(200).toArray();
  const queue = [...sources];
  const results: Awaited<ReturnType<typeof testSource>>[] = [];
  await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
    while (queue.length) {
      const source = queue.shift();
      if (source) results.push(await testSource(source.id));
    }
  }));
  return { checked: results.length, results };
}