import * as engine from "./engine.server";
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
    const items = source.kind === "telegram" ? await engine.fetchTelegram(value) : source.kind === "rss" ? await engine.fetchRss(value) : await engine.fetchWeb(value);
    result = { status: items.length ? "ok" : "empty", posts: items.length, message: items.length ? `${items.length} posts readable. No deals imported or sent.` : "Source loaded, but no readable posts were found.", checked_at, latency_ms: Date.now() - start };
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