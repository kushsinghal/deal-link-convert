// @ts-nocheck
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Panel, ghostBtn } from "./Panel";

export const STORES = ["Amazon", "Flipkart", "Myntra", "Ajio", "Shopsy", "Meesho", "Croma", "Tata CLiQ", "JioMart", "Nykaa", "Xiaomi", "Snapdeal",
  "Reliance Digital", "Paytm", "Swiggy", "Zomato", "Woohoo", "Gyftr", "Other"];
const NAMES = { extrape: "ExtraPe", earnkaro: "EarnKaro", sankmo: "Sankmo" };
const KEYS = ["extrape", "earnkaro", "sankmo"];

// Old single-route settings shown as the equivalent chain.
export const chainFor = (s, store) => {
  const saved = s.affiliate_chains?.[store];
  if (Array.isArray(saved)) return saved.length ? saved : ["original"];
  const order = s.converter_order || KEYS;
  const route = store === "Amazon" ? (s.amazon_route === "earnkaro" ? "earnkaro" : "extrape") : (s.affiliate_routes?.[store] || "extrape");
  if (route === "original") return ["original"];
  const rest = order.filter((k) => k !== route && !(store === "Amazon" && k === "sankmo"));
  return [route, ...rest];
};

const Badge = ({ status, name }) => {
  if (!status) return null;
  const ok = status === "ok", unsup = status === "unsupported", unset = status === "not set";
  return <span title={status} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ok ? "bg-emerald-100 text-emerald-800" : unsup ? "bg-slate-200 text-slate-600" : unset ? "bg-slate-100 text-slate-400" : "bg-rose-100 text-rose-700"}`}>
    {name} {ok ? "✓" : unsup ? "✗" : unset ? "–" : "!"}
  </span>;
};

const StoreRow = ({ store, chain, support, onSave }) => {
  const clean = chain[0] === "original";
  const set = (i, v) => {
    if (i === 0 && v === "original") return onSave(["original"]);
    const next = clean ? [] : [...chain];
    next[i] = v;
    onSave(next.slice(0, 3).filter((k, j, a) => k && k !== "none" && a.indexOf(k) === j));
  };
  const sel = (i, value, opts) => (
    <select aria-label={`${store} ${i === 0 ? "first" : `fallback ${i}`}`} data-testid={`route-${store.toLowerCase().replace(/\s+/g, "-")}-${i}`} value={value}
      onChange={(e) => set(i, e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold">{opts}</select>
  );
  const used = (i) => chain.slice(0, i);
  return (
    <div className="space-y-2 border-b border-slate-200 py-3" data-testid={`store-route-row-${store.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm font-semibold">{store}</span>
        {support && KEYS.map((k) => <Badge key={k} name={NAMES[k]} status={support[k]} />)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        {sel(0, chain[0], <>{KEYS.map((k) => <option key={k} value={k}>{NAMES[k]}</option>)}<option value="original">Keep clean link</option></>)}
        {!clean && [1, 2].map((i) => chain.length >= i && (
          <span key={i} className="flex items-center gap-1.5">→ {sel(i, chain[i] || "none", <><option value="none">No fallback</option>
            {KEYS.filter((k) => !used(i).includes(k)).map((k) => <option key={k} value={k}>{NAMES[k]}</option>)}</>)}</span>
        ))}
      </div>
    </div>
  );
};

export const StoreRoutesPanel = ({ s, setS }) => {
  const [checking, setChecking] = useState(!!s.store_support?.running);
  const support = s.store_support?.results || {};
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(async () => {
      try { const { data } = await api.get("/settings"); setS(data); if (!data.store_support?.running) { setChecking(false); toast.success("Store support check finished"); } } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [checking]);
  const save = async (store, chain) => {
    try { const { data } = await api.put("/settings", { affiliate_chains: { ...(s.affiliate_chains || {}), [store]: chain } }); setS(data);
      toast.success(`${store}: ${chain[0] === "original" ? "clean link" : chain.map((k) => NAMES[k]).join(" → ")}`); } catch (e) { toast.error(errMsg(e)); }
  };
  const runCheck = async () => { try { await api.post("/affiliate/support-check"); setChecking(true); toast("Checking every store with each converter (1–3 min)…"); } catch (e) { toast.error(errMsg(e)); } };
  const noSupport = (st) => support[st] && KEYS.every((k) => support[st][k] !== "ok");
  const supported = STORES.filter((st) => !noSupport(st)), unsupported = STORES.filter(noSupport);
  return (
    <Panel testid="store-routes-panel" title="Affiliate route by store" desc="Each store tries its converters left to right. The next one is used only if the one before fails or has no token. Keep clean link removes other people's tracking and posts the plain store link — nobody earns from it, including you.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button data-testid="store-support-check-button" className={ghostBtn} onClick={runCheck} disabled={checking}>{checking ? "Checking…" : "Check which converter supports each store"}</Button>
        {s.store_support?.checked_at && <span data-testid="store-support-checked-at" className="text-xs text-slate-500">Last check: {new Date(s.store_support.checked_at).toLocaleString()}</span>}
      </div>
      <p className="mb-2 text-[11px] text-slate-500">✓ converts · ✗ not supported by that converter · – no token · ! error (hover to read)</p>
      {supported.map((st) => <StoreRow key={st} store={st} chain={chainFor(s, st)} support={support[st]} onSave={(c) => save(st, c)} />)}
      {unsupported.length > 0 && (
        <details data-testid="unsupported-stores" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Not supported by your converters ({unsupported.length}): {unsupported.join(", ")}</summary>
          <p className="mt-2 text-xs text-slate-600">None of your converters made an earning link for these stores in the last check, so their links stay clean. If you add a new converter later, run the check again.</p>
          {unsupported.map((st) => <StoreRow key={st} store={st} chain={chainFor(s, st)} support={support[st]} onSave={(c) => save(st, c)} />)}
        </details>
      )}
    </Panel>
  );
};

const RATES = [
  ["Flipkart", "up to ~8%", "~1–12% by category", "check app"],
  ["Amazon", "up to ~9%, needs ExtraPe Amazon approval", "~0.5–9%", "check app"],
  ["Myntra", "~7.5–9%", "~5–15%", "check app"],
  ["Ajio", "~10%", "~5–10%", "check app"],
  ["Shopsy", "up to ~11%", "check app", "check app"],
  ["Meesho", "not on your ExtraPe account", "~5–15%", "check app"],
];
export const CommissionPanel = () => (
  <Panel testid="commission-panel" title="Approximate commission by store" desc="From the converters' public pages and blogs (June 2026). Rates change often and depend on category; always check the live rate card in each app before you rely on it.">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-3">Store</th><th className="pr-3">ExtraPe</th><th className="pr-3">EarnKaro</th><th>Sankmo</th></tr></thead>
        <tbody>{RATES.map(([st, ...r]) => <tr key={st} className="border-b border-slate-100"><td className="py-2 pr-3 font-semibold">{st}</td>{r.map((v, i) => <td key={i} className="pr-3 text-slate-700">{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <p className="mt-3 text-xs text-slate-500">Food and payment apps (Swiggy, Zomato, Paytm) and gift-card sites usually pay little or nothing through these converters. Use the support check above to see what your own accounts can convert.</p>
  </Panel>
);
