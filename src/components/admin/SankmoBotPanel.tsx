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
  const [error, setError] = useState(""), [test, setTest] = useState(null);
  const load = async () => { try { setSt((await api.get("/sankmo-bot/status")).data); } catch (e) { setError(errMsg(e)); } };
  useEffect(() => { load(); }, []);
  const call = async (path, body, msg) => {
    setBusy(true);
    setError("");
    try { const { data } = await api.post(`/sankmo-bot/${path}`, body); toast.success(data.password_required ? "Enter your Telegram two-step password" : path === "send-code" ? (data.via_app ? "Code sent to your Telegram app" : "Telegram sent a login code") : msg); setCode(""); setPw(""); if (data.connected) setPhone(""); await load(); } catch (e) { setError(errMsg(e)); await load(); } finally { setBusy(false); }
  };
  const runTest = async () => {
    setBusy(true); setTest(null);
    try { setTest({ ok: true, link: (await api.post("/sankmo-bot/test", {})).data.link }); } catch (e) { setTest({ ok: false, error: errMsg(e) }); } finally { setBusy(false); }
  };
  if (!st) return <Panel testid="sankmo-bot-panel" title="Sankmo via Telegram"><p data-testid="sankmo-bot-loading">{error || "Loading Telegram setup…"}</p><Button data-testid="sankmo-bot-retry" onClick={load}>Retry</Button></Panel>;
  return <Panel testid="sankmo-bot-panel" title="Sankmo via Telegram (@sankmo_bot)" desc="Your Telegram account sends each link to @sankmo_bot and reads the converted link it replies with. Log in to @sankmo_bot with your Sankmo account in Telegram first.">
    <p data-testid="sankmo-api-credentials-status" className={`mb-3 text-xs ${st.credentials_ready ? "text-emerald-800" : "text-amber-800"}`}>{st.credentials_ready ? "API ID & API Hash configured securely" : `${st.credentials_problem || "API ID & API Hash are missing or invalid."} Add it in Render → your service → Environment, save, and wait for the redeploy.`}</p>
    <p data-testid="sankmo-api-credentials-help" className="mb-3 text-xs text-slate-600">Server settings: <code>TELEGRAM_API_ID</code> and <code>TELEGRAM_API_HASH</code>. These are not a BotFather token or a Sankmo API token.</p>
    <a data-testid="telegram-api-tools-link" href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className="mb-4 inline-block text-xs font-semibold underline">Telegram API development tools ↗</a>
    {error && <p data-testid="sankmo-bot-error" role="alert" className="mb-3 text-xs text-rose-700">{error}</p>}
    {st.connected ? <div className="space-y-3">
        {st.credentials_ready
          ? <p data-testid="sankmo-bot-connected" className="text-sm text-emerald-800">Logged in as <b>{st.user}</b>. Press Test Sankmo to confirm links really convert.</p>
          : <p data-testid="sankmo-bot-connected" className="text-sm text-amber-800">A saved Telegram login for <b>{st.user}</b> exists, but Sankmo cannot work on this server until the API ID & API Hash are added.</p>}
        {test && <p data-testid="sankmo-bot-test-result" className={`break-all text-xs ${test.ok ? "text-emerald-800" : "text-rose-700"}`}>{test.ok ? `Working. Sankmo returned: ${test.link}` : `Not working: ${test.error}`}</p>}
        <div className="flex flex-wrap gap-2">
          <Button data-testid="sankmo-bot-test" className={primaryBtn} disabled={busy || !st.credentials_ready} onClick={runTest}>{busy ? "Please wait…" : "Test Sankmo"}</Button>
          <Button data-testid="sankmo-bot-disconnect" className={ghostBtn} disabled={busy} onClick={() => window.confirm("Remove only the Sankmo Telegram login from this site? Your converter bot and your Telegram on your phone stay connected.") && call("disconnect", {}, "Telegram disconnected")}>Disconnect</Button>
        </div>
      </div>
      : <div className="space-y-3">
        <label htmlFor="sankmo-phone" className="text-xs font-semibold">Telegram phone number</label>
        <div className="flex flex-wrap gap-2"><Input id="sankmo-phone" data-testid="sankmo-bot-phone-input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" className={`${fieldCls} min-w-0 flex-1`} />
          <Button data-testid="sankmo-bot-send-code" className={ghostBtn} disabled={busy || !phone.trim() || !st.credentials_ready} onClick={() => call("send-code", { phone }, "Code sent")}>{st.code_sent ? "Send new code" : "Send code"}</Button></div>
        {st.code_sent && <>
          {!st.password_required && <Input aria-label="Telegram login code" data-testid="sankmo-bot-code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Login code from Telegram" className={fieldCls} />}
          {st.password_required && <Input aria-label="Telegram two-step password" data-testid="sankmo-bot-password-input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Telegram two-step password" className={fieldCls} />}
          <Button data-testid="sankmo-bot-verify" className={primaryBtn} disabled={busy || (st.password_required ? !pw : !code.trim())} onClick={() => call("verify", { code, password: pw }, "Telegram connected")}>{st.password_required ? "Verify password" : "Verify code"}</Button>
        </>}
        <p data-testid="sankmo-session-notice" className="text-xs text-slate-500">Your encrypted login session stays on the server. Codes expire; Telegram may require a two-step password or rate-limit this connection. A connected account does not guarantee Sankmo conversion.</p>
      </div>}
  </Panel>;
};
