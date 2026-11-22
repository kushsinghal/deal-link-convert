// @ts-nocheck — ported from the original app
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Star, Send, Trash2, ExternalLink } from "lucide-react";
import { api, errMsg, inr, timeAgo, CATS } from "@/lib/api";
import { formatKolkata } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Panel, ghostBtn } from "./Panel";
import { ReviewEditor } from "./ReviewEditor";
import { ScanStatus } from "./ScanStatus";

const DealRow = ({ d, reload }) => {
  const visibleCategories = [...new Set((d.categories || []).map((category) =>
    category === "loot" || category === "heavy_discount" ? "loot_price_drop" : category,
  ))];
  const star = async () => {
    try { await api.put(`/deals/${d.id}/feature`, { featured: !d.featured }); toast.success(d.featured ? "Removed from Best Deals" : "Added to Best Deals"); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const post = async () => {
    try {
      const { data } = await api.post(`/deals/${d.id}/post`);
      const ok = data.post_results.filter((r) => r.status === "success").length;
      data.post_results.length ? toast.success(`Sent to ${ok}/${data.post_results.length} channel(s)`) : toast.error("No channel matches this deal");
    } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async () => {
    if (!window.confirm("Delete this deal?")) return;
    try { await api.delete(`/deals/${d.id}`); toast.success("Deal removed"); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div data-testid={`admin-deal-row-${d.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-[#F5F2EA] p-3">
      <div className="min-w-0 basis-full flex-1 sm:basis-0">
        <p data-testid={`admin-deal-title-${d.id}`} className="break-words font-semibold">{d.title}</p>
        <p className="break-words font-mono text-[11px] text-slate-500">
          {d.store} · {inr(d.price) || "–"} · {Math.round(d.discount || 0)}% · {visibleCategories.map((c) => c === "loot_price_drop" ? "Loot / Errors & Price Drop" : CATS[c]?.short).join(", ")} · from {d.source || "Unknown source"} · score {d.score} · posted {timeAgo(d.posted_at || d.created_at)}
        </p>
        <dl data-testid={`admin-deal-times-${d.id}`} className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-2">
          <div className="flex gap-1"><dt className="font-semibold">Published on website:</dt><dd data-testid={`admin-deal-published-${d.id}`}>{formatKolkata(d.published_at)}</dd></div>
          <div className="flex gap-1"><dt className="font-semibold">Telegram posted:</dt><dd>{formatKolkata(d.telegram_posted_at)}</dd></div>
          <div className="flex gap-1"><dt className="font-semibold">Converted:</dt><dd>{formatKolkata(d.converted_at)}</dd></div>
          <div className="flex gap-1"><dt className="font-semibold">Fetched:</dt><dd>{formatKolkata(d.created_at)}</dd></div>
          <div className="flex gap-1"><dt className="font-semibold">Source posted:</dt><dd>{formatKolkata(CONVERTER_SOURCES.includes(d.source) ? null : d.posted_at)}</dd></div>
        </dl>
        <p data-testid={`admin-deal-link-${d.id}`} className={`break-all font-mono text-[11px] ${d.converted ? "text-emerald-700" : "text-amber-600"}`}>
          {d.converted ? "Your affiliate link" : "Normal link (not converted)"}: {d.affiliate_url}
        </p>
        {(d.offers || []).length > 0 && (
          <p data-testid={`admin-deal-offers-${d.id}`} className="truncate text-[11px] text-slate-600">
            {d.offers.map((o) => (o.best ? `★ ${o.label}` : o.label)).join(" · ")}
          </p>
        )}
      </div>
      <Button size="sm" className={ghostBtn} onClick={star} data-testid={`admin-deal-star-${d.id}`} aria-label="Star">
        <Star className={`h-4 w-4 ${d.featured ? "fill-[#FFC200] text-[#B7791F]" : ""}`} />
      </Button>
      <Button size="sm" className={ghostBtn} onClick={post} data-testid={`admin-deal-post-${d.id}`} aria-label="Post"><Send className="h-4 w-4" /></Button>
      <a href={d.affiliate_url || d.url} target="_blank" rel="noopener noreferrer" data-testid={`admin-deal-open-${d.id}`}
        className="grid h-9 place-items-center rounded-xl border border-slate-300 px-3 text-slate-800 hover:bg-slate-200"><ExternalLink className="h-4 w-4" /></a>
      <Button size="sm" className={ghostBtn} onClick={remove} data-testid={`admin-deal-delete-${d.id}`} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
      <ReviewEditor deal={d} reload={reload} />
    </div>
  );
};

const MAJOR = ["Flipkart", "Amazon", "Myntra", "Ajio"];
const CONVERTER_SOURCES = ["Convert Links", "Telegram converter"];
const TABS = ["All", ...MAJOR, "Other", "Needs link"];
const inTab = (d, t) => t === "Needs link" ? !!d.link_unresolved : t === "All" || (t === "Other" ? !MAJOR.includes(d.store) : d.store === t);

export const DealsTab = () => {
  const [list, setList] = useState([]);
  const [tab, setTab] = useState("All");
  const load = () => api.get("/review-deals").then((r) => setList(r.data)).catch(e => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);
  const shown = list.filter((d) => inTab(d, tab));
  return (
    <Panel testid="admin-deals-panel" title="Review queue" desc="Fetched deals are published automatically when that rule is on. Use “Save as draft” to unpublish a deal, or add your own buying advice before publishing.">
      <ScanStatus />
      <Button size="sm" className={`${ghostBtn} mb-3`} data-testid="admin-remove-duplicates" onClick={async () => {
        if (!window.confirm("Delete later copies of the same product at the same price (saved within 2 days of the first one)?")) return;
        try { const { data } = await api.post("/deals/remove-duplicates", {}); toast.success(data.removed ? `${data.removed} duplicate deal(s) removed` : "No duplicate deals found"); load(); } catch (e) { toast.error(errMsg(e)); }
      }}><Trash2 className="mr-2 h-4 w-4" />Remove duplicate deals</Button>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} data-testid={`admin-store-tab-${t.toLowerCase()}`} onClick={() => setTab(t)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${tab === t ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-200"}`}>
            {t === "Other" ? "Other stores" : t}
            <span className={`rounded-full px-1.5 text-[10px] ${tab === t ? "bg-white/20" : "bg-slate-200"}`}>{list.filter((d) => inTab(d, t)).length}</span>
          </button>
        ))}
      </div>
      {tab === "Needs link" && <p data-testid="needs-link-help" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">These deals are kept as drafts and hidden from visitors and Telegram: the real store link could not be found, so the link still points to another deal site or short link. Open the link, copy the real store link, add it from Add Deal, then delete the draft here.</p>}
      <div className="space-y-2">
        {shown.map((d) => <DealRow key={d.id} d={d} reload={load} />)}
        {shown.length === 0 && <p className="text-sm text-slate-500">No deals here yet.</p>}
      </div>
    </Panel>
  );
};
