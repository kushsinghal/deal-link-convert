// @ts-nocheck
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Panel, ghostBtn } from "./Panel";
import { CONVERTER_NAMES as NAMES, NETWORK_ORDER as KEYS, routeForStore } from "@/lib/affiliate-routing";

export const STORES = ["Amazon", "Flipkart", "Myntra", "Ajio", "Shopsy", "Meesho", "Croma", "Tata CLiQ", "JioMart", "Nykaa", "Xiaomi", "Snapdeal", "Reliance Digital", "Other"];
export const chainFor = routeForStore;
const slug = s => s.toLowerCase().replace(/\s+/g, "-");
const Badge = ({ status, name, id }) => {
  const labels = { ok: "Sample converted", unsupported: "Sample not supported", "not set": "Not configured" };
  return <span data-testid={id} title={labels[status] || status || "Not checked"} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{name}: {status === "ok" ? "✓" : status === "unsupported" ? "✗" : status?.startsWith("error") ? "!" : "–"}</span>;
};

const StoreRow = ({ store, s, busy, onSave }) => {
  const chain = chainFor(s, store), clean = chain[0] === "original", id = slug(store);
  const keys = store === "Amazon" ? ["amazon", ...KEYS] : KEYS;
  const changed = Array.isArray(s.affiliate_chains?.[store]);
  const set = (i, value) => {
    if (value === "default") return onSave(null);
    if (value === "original") return onSave(["original"]);
    if (value === "none") return onSave(chain.slice(0, i));
    const next = clean ? [] : [...chain]; next[i] = value;
    onSave(next.slice(0, 3).filter((k, j, a) => k && a.indexOf(k) === j));
  };
  const select = i => <select data-testid={`route-${id}-${i}`} aria-label={`${store} ${i ? `fallback ${i}` : "first"}`} disabled={busy}
    value={chain[i] || "none"} onChange={e => set(i, e.target.value)} className="h-9 max-w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold">
    {i > 0 && <option value="none">No fallback</option>}
    {keys.filter(k => !chain.slice(0, i).includes(k)).map(k => <option key={k} value={k}>{NAMES[k]}</option>)}
    {i === 0 && <><option value="original">Keep clean link</option><option value="default">Reset to default order</option></>}
  </select>;
  return <div data-testid={`store-route-row-${id}`} className="space-y-2 border-b border-slate-200 py-3">
    <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm font-semibold">{store}</span>{KEYS.map(k => <Badge key={k} id={`support-${id}-${k}`} name={NAMES[k]} status={s.store_support?.results?.[store]?.[k]} />)}</div>
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{select(0)}{!clean && [1, 2].map(i => chain.length >= i && <span key={i} className="flex min-w-0 max-w-full items-center gap-1.5">→ {select(i)}</span>)}</div>
    <p data-testid={`route-mode-${id}`} className="text-[11px] text-slate-500">{changed ? "Custom store order" : "Default / saved legacy preference"}{chain.includes("amazon") && !s.amazon_tag ? " · Amazon tag not saved yet" : ""}</p>
  </div>;
};

export const StoreRoutesPanel = ({ s, setS }) => {
  const [checking, setChecking] = useState(!!s.store_support?.running), [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(async () => {
      try { const { data } = await api.get("/settings"); setS(data); if (!data.store_support?.running) { setChecking(false); toast.success("Store support check finished"); } }
      catch (e) { setError(errMsg(e)); setChecking(false); }
    }, 5000);
    return () => clearInterval(t);
  }, [checking]);
  const save = async (store, chain) => {
    setSaving(true);
    const chains = { ...(s.affiliate_chains || {}) }; if (chain) chains[store] = chain; else delete chains[store];
    try { const { data } = await api.put("/settings", { affiliate_chains: chains, ...(!chain && store === "Amazon" ? { amazon_route: "default" } : {}), ...(!chain && store !== "Amazon" ? { affiliate_routes: { ...(s.affiliate_routes || {}), [store]: "default" } } : {}) }); setS(data); toast.success(`${store} route saved`); }
    catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  };
  const run = async () => { setError(""); try { await api.post("/affiliate/support-check"); setChecking(true); } catch (e) { setError(errMsg(e)); } };
  return <Panel testid="store-routes-panel" title="Affiliate route by store" desc="Shared by website imports, Convert Links and the Telegram converter. Configured converters are tried left to right; Keep clean link skips affiliate conversion.">
    <Button data-testid="store-support-check-button" className={ghostBtn} onClick={run} disabled={checking}>{checking ? "Checking samples…" : "Check store samples"}</Button>
    {s.store_support?.checked_at && <p data-testid="store-support-checked-at" className="mt-2 text-xs text-slate-500">Checked: {new Date(s.store_support.checked_at).toLocaleString()}</p>}
    {(error || s.store_support?.error) && <p data-testid="store-support-error" role="alert" className="mt-2 text-xs text-rose-700">{error || s.store_support.error}</p>}
    <p data-testid="store-support-disclaimer" className="mt-3 text-xs text-slate-600">A failed sample is not a permanent store block. Product links can behave differently. Save a route and use Test a link for the exact URL. “Other” covers unlisted retailers.</p>
    <div className="mt-2 grid gap-x-8 md:grid-cols-2">{STORES.map(store => <StoreRow key={store} store={store} s={s} busy={saving} onSave={chain => save(store, chain)} />)}</div>
    <p data-testid="offer-stores-note" className="mt-3 text-xs text-slate-600">Paytm, Swiggy, Zomato, Woohoo and Gyftr are offer pages: never converted, shown under Offers &amp; Coupons with their clean link.</p>
  </Panel>;
};

export const CommissionPanel = () => <Panel testid="commission-panel" title="Commission & store eligibility" desc="Live commission rates are not connected. A converted sample verifies link creation, not a payable commission.">
  <div className="space-y-3 text-sm">{[["ExtraPe", "https://www.extrape.com/"], ["EarnKaro", "https://earnkaro.com/"], ["Sankmo", "https://sankmo.in/"], ["Amazon Associates", "https://affiliate-program.amazon.in/"]].map(([name, url]) => <div key={name} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3"><span>{name}</span><a data-testid={`commission-${slug(name)}`} href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold underline">Check account rate card ↗</a></div>)}</div>
  <p data-testid="commission-note" className="mt-4 text-xs text-slate-600">Store approval, category, eligible orders, cancellations and the network's current terms determine payment. No fixed percentage is assumed for any store.</p>
</Panel>;