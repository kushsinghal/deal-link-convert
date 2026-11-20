// @ts-nocheck
import { useEffect, useState } from "react";
import { Search, RefreshCw, ArrowUpRight } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { GUIDES } from "@/lib/editorial";
import { DealCard } from "@/components/DealCard";
import { Input } from "@/components/ui/input";

const FILTERS = [["all", "All deals"], ["best", "Best deals"], ["supercoin_100", "SuperCoins"], ["gift_card", "Gift cards"], ["loot_price_drop", "Price drops"], ["gold", "Gold & silver"], ["lowest", "Lowest observed"], ["starred", "Editor's picks"]];
export default function DealsPage() {
  const [deals, setDeals] = useState([]), [cat, setCat] = useState("all"), [q, setQ] = useState(""), [sort, setSort] = useState("latest");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [tick, setTick] = useState(0);
  const reload = () => setTick(t => t + 1);
  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try { const { data } = await api.get("/deals", { params: { category: cat, q, sort } }); if (current) { setDeals(data); setError(""); } }
      catch (e) { if (current) setError(errMsg(e)); }
      finally { if (current) setLoading(false); }
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [cat, q, sort, tick]);
  return <main className="mx-auto max-w-7xl px-4 py-9 sm:px-8 sm:py-12">
    <section className="grid gap-7 border-b border-slate-300 pb-9 md:grid-cols-[1fr_auto] md:items-end">
      <div><p className="text-xs font-bold uppercase text-emerald-800">Shop thoughtfully. Save where it counts.</p><h1 className="mt-3 text-4xl font-black sm:text-5xl lg:text-6xl">DealLoot<span className="text-[#FF5A1F]">.</span></h1><p className="mt-4 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">Shopping offers with context, not just a discount. Compare the conditions before you buy.</p></div>
      <a data-testid="home-guides-link" href="/guides" className="flex items-center gap-2 font-semibold underline underline-offset-4 transition-colors hover:text-orange-700">Read our buying guides <ArrowUpRight className="h-4 w-4" /></a>
    </section>
    <section className="mt-8" aria-label="Reviewed deals">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Reviewed offers</h2><button data-testid="scan-refresh-button" onClick={reload} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button></div>
      <p data-testid="home-affiliate-disclosure" className="mt-2 text-xs leading-5 text-slate-600">Some links may earn us a commission. Prices are observations, not live quotes. <a data-testid="home-disclosure-link" href="/info/disclosure" className="underline">How our links work</a></p>
      <div className="my-5 flex flex-wrap gap-2">{FILTERS.map(([key, label]) => <button key={key} data-testid={`category-filter-${key}`} aria-pressed={cat === key} onClick={() => setCat(key)} className={`rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${cat === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:border-orange-600"}`}>{label}</button>)}</div>
      <div className="flex gap-2"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><Input data-testid="deal-search-input" aria-label="Search deals" value={q} onChange={e => setQ(e.target.value)} placeholder="Search offers…" className="bg-white pl-9" /></div><select data-testid="deal-sort-select" aria-label="Sort deals" value={sort} onChange={e => setSort(e.target.value)} className="max-w-[140px] rounded-lg border border-slate-300 bg-white px-2 text-xs"><option value="latest">Latest</option><option value="starred">Editor's picks</option><option value="discount">Largest discount</option><option value="price">Lowest price</option></select></div>
      {loading ? <p data-testid="deals-loading" className="py-14 text-sm text-slate-500">Loading offers…</p> : error ? <p data-testid="deals-load-error" role="alert" className="py-14 text-sm text-rose-700">{error}</p> : !deals.length ? <div data-testid="deals-empty" className="border-b border-slate-200 py-12"><p className="font-semibold">{q ? "No offers match your search." : "No reviewed offers in this category yet."}</p><p className="mt-2 text-sm text-slate-600">In the meantime, explore the buying guides below.</p></div> : <div data-testid="deals-grid" className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{deals.map((deal, index) => <DealCard key={deal.id} deal={deal} index={index} onChange={reload} />)}</div>}
    </section>
    <section className="mt-10"><h2 className="text-lg font-bold">Good questions. Better purchases.</h2><div className="mt-5 grid gap-6 md:grid-cols-3">{GUIDES.map((guide, index) => <a key={guide.slug} data-testid={`home-guide-${guide.slug}`} href={`/guides/${guide.slug}`} className="group grid grid-cols-[48px_1fr] items-start gap-3 border-t border-slate-300 pt-5"><span className="font-display text-2xl font-bold text-emerald-800">{String(index + 1).padStart(2, "0")}</span><div><h3 className="text-base font-semibold group-hover:underline">{guide.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{guide.summary}</p></div></a>)}</div></section>
  </main>;
}