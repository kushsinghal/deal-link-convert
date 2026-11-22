// @ts-nocheck
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { formatKolkata } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Panel, fieldCls, primaryBtn, ghostBtn } from "./Panel";

const s1 = (ms) => `${((ms || 0) / 1000).toFixed(2)}s`;
const secs = (ms) => (ms == null ? "" : ` · ${(ms / 1000).toFixed(1)}s after the source post`);

const Cell = ({ label, testid, children, tone = "" }) => (
  <div className="min-w-0 rounded-xl border border-slate-200 bg-[#F5F2EA] p-3">
    <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    <div data-testid={testid} className={`mt-1 break-words text-sm ${tone}`}>{children}</div>
  </div>
);

const StatusView = ({ st, load }) => (
  <Panel testid="reader-status-panel" title="Reader status" desc="Updates every 5 seconds." action={<Button data-testid="reader-status-refresh" className={ghostBtn} onClick={load}><RefreshCw className="h-4 w-4" /></Button>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Cell label="Connection" testid="reader-connected" tone={st.connected ? "text-emerald-800" : "text-rose-700"}>{st.connected ? `Connected as ${st.user}` : st.enabled ? "Not connected yet" : "Switched off"}</Cell>
      <Cell label="Source channels" testid="reader-sources">{st.sources.length ? st.sources.map((s) => <p key={s.name} className={s.ok ? "text-emerald-800" : "text-rose-700"}>{s.ok ? "✓" : "✗"} {s.name}{s.error ? ` — ${s.error}` : ""}</p>) : "—"}</Cell>
      <Cell label="Last post read" testid="reader-last-read">{st.last_read ? `${st.last_read.source} #${st.last_read.message_id} · ${formatKolkata(st.last_read.at)}${st.last_read.title ? ` · ${st.last_read.title}` : ""} · reached the server ${((st.last_read.delivery_ms || 0) / 1000).toFixed(1)}s after posting (${st.last_read.via})` : "None yet"}</Cell>
      <Cell label="Last post sent" testid="reader-last-sent">{st.last_sent ? `${st.last_sent.to.join(", ")} · ${formatKolkata(st.last_sent.at)}${secs(st.last_sent.total_ms)}${st.last_sent.by ? ` · by ${st.last_sent.by}` : ""}` : "None yet"}
        {st.last_sent?.processing_ms != null && <p data-testid="reader-last-timing" className="mt-1 font-mono text-[11px] text-slate-600">Telegram delivery {s1(st.last_sent.delivery_ms)} · opening link {s1(st.last_sent.open_ms)} · convert + repeat check {s1(st.last_sent.convert_ms)} · posting {s1(st.last_sent.send_ms)} · our part {s1(st.last_sent.processing_ms)}</p>}</Cell>
      <Cell label="Last error" testid="reader-last-error" tone={st.last_error ? "text-rose-700" : ""}>{st.last_error ? `${formatKolkata(st.last_error.at)} · ${st.last_error.where}: ${st.last_error.message}` : "None"}</Cell>
    </div>
  </Panel>
);

const SettingsForm = ({ s, setS, bots }) => {
  const [f, setF] = useState({ caption: s.reader_caption || "", sources: (s.reader_sources || []).join(", "), dests: s.reader_destinations || [], bot: s.reader_post_bot || "account", photo: !!s.reader_photo, tryShort: !!s.reader_try_short });
  const save = async () => {
    try {
      const { data } = await api.put("/settings", { reader_caption: f.caption, reader_sources: f.sources.split(/[\s,]+/).filter(Boolean), reader_destinations: f.dests, reader_post_bot: f.bot, reader_photo: f.photo, reader_try_short: f.tryShort });
      setS(data); toast.success("Reader settings saved");
    } catch (e) { toast.error(errMsg(e)); }
  };
  const setDest = (i, patch) => setF({ ...f, dests: f.dests.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  return (
    <Panel testid="reader-settings-panel" title="What gets posted" desc="Each source post becomes one new post: your caption at the top, the product, and only your converted links. Nothing is forwarded or copied.">
      <div className="space-y-4">
        <label className="block text-xs font-semibold" htmlFor="reader-caption">Caption at the top (empty = automatic “Supercoin Deals” / “Flipkart Deal”)</label>
        <Textarea id="reader-caption" data-testid="reader-caption-input" value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} placeholder="Supercoin Deals" className="rounded-xl border-slate-300 bg-[#F5F2EA]" />
        <label className="block text-xs font-semibold" htmlFor="reader-sources">Source channels</label>
        <Input id="reader-sources" data-testid="reader-sources-input" value={f.sources} onChange={(e) => setF({ ...f, sources: e.target.value })} className={fieldCls} />
        <p className="text-xs font-semibold">Post to (only deals priced above the minimum)</p>
        {f.dests.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label="Destination channel" data-testid={`reader-dest-chat-${i}`} value={d.chat} onChange={(e) => setDest(i, { chat: e.target.value })} className={`${fieldCls} min-w-0 flex-1`} />
            <Input aria-label="Minimum price" data-testid={`reader-dest-min-${i}`} type="number" min="0" value={d.min_price} onChange={(e) => setDest(i, { min_price: Number(e.target.value) })} className={`${fieldCls} w-32`} />
          </div>
        ))}
        <label className="block text-xs font-semibold" htmlFor="reader-bot">Who posts (must be an admin of both channels)</label>
        <select id="reader-bot" data-testid="reader-bot-select" value={f.bot} onChange={(e) => setF({ ...f, bot: e.target.value })} className={`${fieldCls} w-full border px-3`}>
          <option value="account">Spare account (fastest)</option>
          <option value="converter">Converter bot{s.telegram_converter_username ? ` (@${s.telegram_converter_username})` : ""}</option>
          {bots.map((b) => <option key={b.id} value={b.id}>{b.name} bot</option>)}
        </select>
        <label className="flex items-center gap-3 text-sm"><Switch data-testid="reader-photo-switch" checked={f.photo} onCheckedChange={(v) => setF({ ...f, photo: v })} /> Include the source photo (adds about 0.5–1 s)</label>
        <label className="flex items-center gap-3 text-sm"><Switch data-testid="reader-try-short-switch" checked={f.tryShort} onCheckedChange={(v) => setF({ ...f, tryShort: v })} /> Test: send the source's short link straight to ExtraPe (can save about 0.7 s if ExtraPe accepts it)</label>
        <Button data-testid="reader-settings-save" className={primaryBtn} onClick={save}>Save</Button>
      </div>
    </Panel>
  );
};

export const ReaderTab = () => {
  const [st, setSt] = useState(null), [s, setS] = useState(null), [bots, setBots] = useState([]), [error, setError] = useState("");
  const load = () => api.get("/reader/status").then((r) => setSt(r.data), (e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    api.get("/settings").then((r) => setS(r.data), (e) => setError(errMsg(e)));
    api.get("/destinations").then((r) => setBots(r.data), () => {});
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const toggle = async (on) => {
    try { const { data } = await api.put("/settings", { reader_enabled: on }); setS(data); toast.success(on ? "Reader switched on" : "Reader switched off"); setTimeout(load, 2500); } catch (e) { toast.error(errMsg(e)); }
  };
  if (!st || !s) return <p data-testid="reader-loading" className="text-sm text-slate-600">{error || "Loading reader…"}</p>;
  return (
    <div className="space-y-6">
      <Panel testid="reader-panel" title="Private Channel Reader" desc="Your spare Telegram account (the login in Affiliate Setup → Sankmo via Telegram) reads the source channels live and your bot posts a new post within seconds.">
        <label className="flex items-center gap-3 text-sm font-semibold"><Switch data-testid="reader-enabled-switch" checked={!!s.reader_enabled} onCheckedChange={toggle} /> {s.reader_enabled ? "On" : "Off"}</label>
        {!s.tg_connected && <p data-testid="reader-login-missing" className="mt-3 text-xs text-amber-800">Log in with your spare Telegram account in Affiliate Setup → Keys &amp; logins first.</p>}
      </Panel>
      <StatusView st={st} load={load} />
      <SettingsForm s={s} setS={setS} bots={bots} />
    </div>
  );
};
