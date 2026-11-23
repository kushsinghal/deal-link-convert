// @ts-nocheck — ported from the original app
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel, fieldCls, primaryBtn, ghostBtn } from "./Panel";
import { TelegramConverterPanel } from "./TelegramConverterPanel";
import { StoreRoutesPanel, CommissionPanel } from "./StoreRoutesPanel";
import { SankmoBotPanel, ConverterOrderPanel } from "./SankmoBotPanel";
import { AmazonTagPanel } from "./AmazonTagPanel";
import { ConverterApiPanel } from "./ConverterApiPanel";
import { BotCommandsPanel } from "./BotCommandsPanel";

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
    <Tabs defaultValue="keys" data-testid="affiliate-setup-tabs">
      <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {[["keys", "1 · Keys & logins"], ["routes", "2 · Order & stores"], ["bot", "3 · Telegram bot"]].map(([k, l]) => <TabsTrigger key={k} value={k} data-testid={`affiliate-subtab-${k}`} className="rounded-md px-3 py-1.5 text-xs font-semibold data-[state=active]:bg-[#FF5A1F] data-[state=active]:text-white">{l}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="keys" className="mt-5 grid items-start gap-6 lg:grid-cols-2">
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
          ) : s.convert_mode === "telegram" ? <p data-testid="sankmo-telegram-mode-hint" className="text-xs">Telegram login is in the Sankmo via Telegram panel.</p> : (
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
        <div className="space-y-6"><SankmoBotPanel /><AmazonTagPanel s={s} setS={setS} /><ConverterApiPanel /></div>
      </TabsContent>
      <TabsContent value="routes" className="mt-5 grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6"><ConverterOrderPanel s={s} setS={setS} /><Tester /><CommissionPanel />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button data-testid="sankmo-reconvert-button" className={`${ghostBtn} w-full`}>Reconvert recent deals with current store settings</Button>
        </AlertDialogTrigger>
        <AlertDialogContent data-testid="reconvert-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Reconvert recent deals?</AlertDialogTitle>
            <AlertDialogDescription>This rewrites the affiliate links of deals from the last 24 hours using your current store settings. It does not repost anything to Telegram and keeps each deal's original post time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="reconvert-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="sankmo-reconvert-confirm" onClick={async () => { try { await api.post("/deals/reconvert"); toast.success("Recent deal links updated"); } catch (e) { toast.error(errMsg(e)); } }}>Reconvert</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
        <div className="lg:col-span-2"><StoreRoutesPanel s={s} setS={setS} /></div>
      </TabsContent>
      <TabsContent value="bot" className="mt-5 grid items-start gap-6 lg:grid-cols-2">
        <TelegramConverterPanel settings={s} reload={load} /><BotCommandsPanel s={s} reload={load} />
      </TabsContent>
    </Tabs>
  );
};
