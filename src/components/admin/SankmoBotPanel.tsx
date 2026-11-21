// @ts-nocheck
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Panel, fieldCls, primaryBtn, ghostBtn } from "./Panel";

const NAMES = { extrape: "ExtraPe", earnkaro: "EarnKaro", sankmo: "Sankmo" };

export const ConverterOrderPanel = ({ s, setS }) => {
  const order = s.converter_order || ["extrape", "earnkaro", "sankmo"];
  const move = async (i, d) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    try { const { data } = await api.put("/settings", { converter_order: next }); setS(data); toast.success("Converter order saved"); } catch (e) { toast.error(errMsg(e)); }
  };
  return <Panel testid="converter-order-panel" title="Converter order" desc="Default order for stores you have not set yourself in Affiliate route by store. The next one is used only if the one above fails or has no token.">
    <ol className="space-y-2">{order.map((k, i) => <li key={k} data-testid={`converter-order-item-${k}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="w-6 text-sm font-bold text-slate-500">{i + 1}.</span><span className="flex-1 text-sm font-semibold">{NAMES[k]}</span>
      <Button size="icon" aria-label={`Move ${NAMES[k]} up`} data-testid={`converter-order-up-${k}`} className={ghostBtn} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
      <Button size="icon" aria-label={`Move ${NAMES[k]} down`} data-testid={`converter-order-down-${k}`} className={ghostBtn} disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
    </li>)}</ol>
    <p className="mt-3 text-xs text-slate-500">Once you change a store in Affiliate route by store, that store uses its own order instead of this one.</p>
  </Panel>;
};

export const SankmoBotPanel = () => {
  const [st, setSt] = useState(null), [phone, setPhone] = useState(""), [code, setCode] = useState(""), [pw, setPw] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { try { setSt((await api.get("/sankmo-bot/status")).data); } catch (e) { toast.error(errMsg(e)); } };
  useEffect(() => { load(); }, []);
  const call = async (path, body, msg) => {
    setBusy(true);
    try { await api.post(`/sankmo-bot/${path}`, body); toast.success(msg); setCode(""); setPw(""); await load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  if (!st) return null;
  return <Panel testid="sankmo-bot-panel" title="Sankmo via Telegram (@sankmo_bot)" desc="Your Telegram account sends each link to @sankmo_bot and reads the converted link it replies with. Log in to @sankmo_bot with your Sankmo account in Telegram first.">
    {!st.credentials_ready ? <p data-testid="sankmo-bot-missing-creds" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Telegram API ID and API Hash are not added yet.</p>
      : st.connected ? <div className="space-y-3">
        <p data-testid="sankmo-bot-connected" className="text-sm text-emerald-800">Connected as <b>{st.user}</b>. Sankmo links convert through @sankmo_bot.</p>
        <Button data-testid="sankmo-bot-disconnect" className={ghostBtn} disabled={busy} onClick={() => window.confirm("Log this app out of your Telegram account?") && call("disconnect", {}, "Telegram disconnected")}>Disconnect</Button>
      </div>
      : <div className="space-y-3">
        <div className="flex gap-2"><Input data-testid="sankmo-bot-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" className={fieldCls} />
          <Button data-testid="sankmo-bot-send-code" className={ghostBtn} disabled={busy || !phone.trim()} onClick={() => call("send-code", { phone }, "Code sent to your Telegram app")}>Send code</Button></div>
        {st.code_sent && <>
          <Input data-testid="sankmo-bot-code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Login code from Telegram" className={fieldCls} />
          <Input data-testid="sankmo-bot-password-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Telegram two-step password (only if you set one)" className={fieldCls} />
          <Button data-testid="sankmo-bot-verify" className={primaryBtn} disabled={busy || !code.trim()} onClick={() => call("verify", { code, password: pw }, "Telegram connected")}>Log in</Button>
        </>}
        <p className="text-xs text-slate-500">Your login stays on the server and is never shown in the browser. Links are sent at most one every 1.5 seconds so Telegram doesn't flag your account.</p>
      </div>}
  </Panel>;
};
