// @ts-nocheck — ported from the original app
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Panel, fieldCls, primaryBtn, ghostBtn } from "./Panel";
import { TelegramConverterPanel } from "./TelegramConverterPanel";
import { SankmoBotPanel, ConverterOrderPanel } from "./SankmoBotPanel";

const Tester = () => {
  const [url, setUrl] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const { data } = await api.post("/convert", { url }); setRes(data); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Panel testid="sankmo-test-panel" title="Test a link" desc="Paste any store link and see the link that will be posted. Other people's tracking tags are removed first.">
      <div className="flex gap-2">
        <Input data-testid="sankmo-test-url-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://amzn.to/… or flipkart link" className={fieldCls} />
        <Button data-testid="sankmo-test-button" className={ghostBtn} onClick={run} disabled={busy}>{busy ? "…" : "Convert"}</Button>
      </div>
      {res && (
        <div data-testid="sankmo-test-result" className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-[#F5F2EA] p-4 font-mono text-xs">
          <p className="text-slate-500">Cleaned: <span className="break-all text-slate-700">{res.cleaned}</span></p>
          <p className={res.changed ? "text-emerald-700" : "text-amber-600"}>
            {res.changed ? "Converted to your affiliate link" : res.error ? `Failed: ${res.error}` : "Not converted yet (check the selected service settings)"}
          </p>
          <p className="break-all text-slate-800">{res.converted}</p>
        </div>
      )}
    </Panel>
  );
};

const TelegramConnect = () => (
  <div data-testid="tg-unavailable" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
    Converting links through your personal Telegram account (@sankmo_bot) is not available in this version. Use the Sankmo API token option instead.
  </div>
);

const ALL_STORES = ["Flipkart", "Myntra", "Ajio", "Shopsy", "Meesho", "Croma", "Tata CLiQ", "JioMart", "Nykaa", "Xiaomi", "Snapdeal",
  "Reliance Digital", "Paytm", "Swiggy", "Zomato", "Woohoo", "Gyftr"];

const ROUTE_NAMES = { extrape: "ExtraPe", earnkaro: "EarnKaro", sankmo: "Sankmo" };

const StoresPanel = ({ s, setS }) => {
  const routes = s.affiliate_routes || {};
  const routeFor = (name) => (name === "Amazon" ? (s.amazon_route === "earnkaro" ? "earnkaro" : "extrape") : ({ amazon: "earnkaro" }[routes[name]] || routes[name] || "extrape"));
  const put = async (body, msg) => {
    try { const { data } = await api.put("/settings", body); setS(data); toast.success(msg); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const change = (name, route) => put(name === "Amazon" ? { amazon_route: route } : { affiliate_routes: { ...routes, [name]: route } },
    `${name} now uses ${route === "original" ? "clean link" : ROUTE_NAMES[route]}`);
  const allExtraPe = () => put({ amazon_route: "extrape", affiliate_routes: Object.fromEntries([...ALL_STORES, "Other"].map((n) => [n, "extrape"])) }, "Every store now uses ExtraPe");
  return (
    <Panel testid="sankmo-stores-panel" title="Affiliate route by store" desc="Choose one service per store. ExtraPe is the default; EarnKaro is used as a backup if ExtraPe fails.">
      <Button data-testid="affiliate-all-extrape-button" className={`${ghostBtn} mb-3`} onClick={allExtraPe}>Use ExtraPe for every store</Button>
      <div className="space-y-2">
        {["Amazon", ...ALL_STORES, "Other"].map((n) => (
          <div key={n} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-2">
            <span className="text-sm font-semibold">{n}</span>
            {n === "Amazon" ?
              <select aria-label="Amazon affiliate service" data-testid="affiliate-route-amazon" value={routeFor(n)} onChange={(e) => change(n, e.target.value)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold">
                <option value="extrape">ExtraPe</option>
                <option value="earnkaro">EarnKaro</option>
              </select> :
              <select aria-label={`${n} affiliate service`} data-testid={`affiliate-route-${n.toLowerCase().replace(/\s+/g, "-")}`} value={routeFor(n)}
                onChange={(e) => change(n, e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold">
                <option value="extrape">ExtraPe</option>
                <option value="sankmo">Sankmo → ExtraPe fallback</option>
                <option value="earnkaro">EarnKaro</option>
                <option value="original">Keep clean link</option>
              </select>}
          </div>
        ))}
      </div>
    </Panel>
  );
};

export const SankmoTab = () => {
  const [s, setS] = useState(null);
  const [token, setToken] = useState("");
  const [earnkaroToken, setEarnkaroToken] = useState("");
  const [extrapeToken, setExtrapeToken] = useState("");
  const [loadError, setLoadError] = useState("");
  const load = () => { setLoadError(""); return api.get("/settings").then((r) => setS(r.data)).catch(e => setLoadError(errMsg(e))); };
  useEffect(() => { load(); }, []);
  if (loadError) return <div data-testid="affiliate-settings-error" role="alert" className="space-y-3 text-sm text-rose-700"><p>{loadError}</p><Button data-testid="affiliate-settings-retry" onClick={load}>Retry settings</Button></div>;
  if (!s) return <p data-testid="affiliate-settings-loading" className="text-sm text-slate-600">Loading affiliate settings…</p>;
  const save = async (extra = {}) => {
    try {
      const { data } = await api.put("/settings", { sankmo_api_url: s.sankmo_api_url,
        convert_enabled: s.convert_enabled, sankmo_bot: s.sankmo_bot, convert_mode: s.convert_mode, sankmo_token: token, earnkaro_token: earnkaroToken, extrape_token: extrapeToken, ...extra });
      setS(data); setToken(""); setEarnkaroToken(""); setExtrapeToken("");
      toast.success("Affiliate settings saved");
    } catch (e) { toast.error(errMsg(e)); }
  };
  const modeBtn = (m, label) => (
    <button data-testid={`sankmo-mode-${m}`} onClick={() => save({ convert_mode: m })}
      className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${s.convert_mode === m ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:text-slate-950"}`}>{label}</button>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
    <Panel testid="sankmo-panel" title="Affiliate links" desc="Add your converter tokens. The order they are tried in is set in Converter order.">
        <div className="space-y-5">
          <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <Label className="text-xs text-slate-700">ExtraPe access token {s.extrape_token_masked && <span data-testid="extrape-token-saved" className="font-mono text-emerald-700">· saved {s.extrape_token_masked}</span>}</Label>
            <Input data-testid="extrape-token-input" type="password" disabled={s.extrape_managed} value={extrapeToken} onChange={(e) => setExtrapeToken(e.target.value)}
              placeholder={s.extrape_token_masked ? "Leave empty to keep current token" : "Paste your ExtraPe access token"} className={fieldCls} />
            <p data-testid="extrape-token-help" className="text-xs text-slate-600">{s.extrape_managed ? "Using the secure backend token. Its value is not sent to this browser." : "A backend EXTRAPE_SESSION_SECRET can supply this token securely."}</p>
            <p data-testid="extrape-integration-notice" className="text-xs text-amber-800">Unofficial connection: ExtraPe's website endpoint can change. Amazon links require ExtraPe Amazon approval or your Amazon Associates tag configured inside ExtraPe. Link creation alone does not guarantee commission.</p>
          </div>
          <div className="flex items-center gap-3">
            <Switch data-testid="sankmo-enabled-switch" checked={s.convert_enabled} onCheckedChange={(v) => save({ convert_enabled: v })} />
            <span className="text-sm">Convert links automatically</span>
          </div>
          <div className="flex flex-wrap gap-2">{modeBtn("sankmo_api", "Sankmo API token")}{modeBtn("api", "Custom Sankmo API")}</div>
          {s.convert_mode === "sankmo_api" ? (
              <p data-testid="sankmo-api-help" className="rounded-xl border border-slate-200 bg-[#F5F2EA] p-3 text-xs text-slate-700">
              Sankmo converts best through your Telegram login below (@sankmo_bot). The token here is only used when Telegram is not connected.
            </p>
          ) : s.convert_mode === "telegram" ? <TelegramConnect s={s} reload={load} /> : (
            <div><Label className="text-xs text-slate-600">Converter API URL</Label>
              <Input data-testid="sankmo-api-url-input" value={s.sankmo_api_url} onChange={(e) => setS({ ...s, sankmo_api_url: e.target.value })}
                placeholder="https://… (use {url} and {token})" className={fieldCls} /></div>
          )}
          <div><Label className="text-xs text-slate-600">Sankmo token {s.sankmo_token_masked && <span className="font-mono text-emerald-700">· saved {s.sankmo_token_masked}</span>}</Label>
            <Input data-testid="sankmo-token-input" type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={s.sankmo_token_masked ? "Leave empty to keep current token" : "Paste your Sankmo token"} className={fieldCls} /></div>
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <Label className="text-xs text-slate-600">EarnKaro API token {s.earnkaro_token_masked && <span className="font-mono text-emerald-700">· saved {s.earnkaro_token_masked}</span>}</Label>
            <Input data-testid="earnkaro-token-input" type="password" value={earnkaroToken} onChange={(e) => setEarnkaroToken(e.target.value)}
              placeholder={s.earnkaro_token_masked ? "Leave empty to keep current token" : "Paste your EarnKaro token"} className={fieldCls} />
            <p className="text-xs text-slate-500">Optional backup: used when ExtraPe has no token or fails, and for any store set to EarnKaro.</p>
          </div>
          <Button data-testid="sankmo-save-button" className={primaryBtn} onClick={() => save()}>Save</Button>
        </div>
      </Panel>
      <ConverterOrderPanel s={s} setS={setS} />
      <SankmoBotPanel />
      <Tester />
      <StoresPanel s={s} setS={setS} />
      <TelegramConverterPanel settings={s} reload={load} />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button data-testid="sankmo-reconvert-button" className={`${ghostBtn} lg:col-span-2`}>Reconvert recent deals with current store settings</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconvert recent deals?</AlertDialogTitle>
            <AlertDialogDescription>This rewrites the affiliate links of deals from the last 24 hours using your current store settings. It does not repost anything to Telegram and keeps each deal's original post time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="sankmo-reconvert-confirm" onClick={async () => { try { await api.post("/deals/reconvert"); toast.success("Reconverting the last 24h of deals in the background"); } catch (e) { toast.error(errMsg(e)); } }}>Reconvert</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
