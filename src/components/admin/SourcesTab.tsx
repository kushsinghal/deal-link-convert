// @ts-nocheck
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, Plus, Activity } from "lucide-react";
import { api, errMsg, timeAgo } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel, fieldCls, primaryBtn, ghostBtn } from "./Panel";

const SourceRow = ({ s, reload }) => {
  const [busy, setBusy] = useState(false);
  const act = async (action) => {
    setBusy(true);
    try {
      if (action === "delete") {
        if (!window.confirm(`Remove ${s.name}? Existing deals will be kept.`)) return;
        await api.delete(`/sources/${s.id}`);
      } else {
        const { data } = await api.post(`/sources/${s.id}/${action}`);
        if (data.error || data.status === "error") toast.error(data.error || data.message);
        else toast.success(action === "test" ? data.message : `${data.fetched} posts scanned, ${data.new_deals} drafts added`);
      }
      await reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <div data-testid={`source-row-${s.id}`} className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
    <div className="min-w-0 basis-full flex-1 sm:basis-0">
      <p data-testid={`source-name-${s.id}`} className="break-words font-semibold">{s.name} <span className="text-xs font-normal text-slate-500">{s.kind}</span></p>
      <p data-testid={`source-url-${s.id}`} className="break-all text-xs text-slate-500">{s.value}</p>
      <p data-testid={`source-status-${s.id}`} className="mt-2 break-words text-xs text-slate-600">Last import: {timeAgo(s.last_fetched_at)} · {s.total_deals || 0} drafts imported</p>
      {s.last_error && <p role="alert" data-testid={`source-import-error-${s.id}`} className="mt-1 break-words text-xs text-rose-700">Import error: {s.last_error}</p>}
      {s.health && <p data-testid={`source-health-${s.id}`} className={`mt-2 break-words text-xs ${s.health.status === "error" ? "text-rose-700" : "text-emerald-800"}`}>{s.health.status === "ok" ? "Readable" : s.health.status === "empty" ? "No posts" : "Check failed"} · {s.health.message} · {timeAgo(s.health.checked_at)}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Switch aria-label={`Enable ${s.name}`} data-testid={`source-toggle-${s.id}`} disabled={busy} checked={s.enabled} onCheckedChange={async enabled => { try { await api.put(`/sources/${s.id}`, { enabled }); await reload(); } catch (e) { toast.error(errMsg(e)); } }} />
      <Button size="sm" data-testid={`source-test-${s.id}`} className={ghostBtn} onClick={() => act("test")} disabled={busy}><Activity className="mr-1 h-4 w-4" />Test</Button>
      <Button size="icon" title="Import drafts" aria-label="Import drafts" data-testid={`source-fetch-${s.id}`} className={ghostBtn} onClick={() => act("fetch")} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /></Button>
      <Button size="icon" title="Remove source" aria-label="Remove source" data-testid={`source-delete-${s.id}`} className={ghostBtn} onClick={() => act("delete")} disabled={busy}><Trash2 className="h-4 w-4" /></Button>
    </div>
  </div>;
};

export const SourcesTab = () => {
  const [list, setList] = useState([]), [value, setValue] = useState(""), [kind, setKind] = useState("telegram");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = async () => { try { setList((await api.get("/sources")).data); setError(""); } catch (e) { setError(errMsg(e)); } };
  useEffect(() => { load(); }, []);
  const run = async (action) => {
    setBusy(true);
    try {
      if (action === "add") { await api.post("/sources", { value, kind }); setValue(""); toast.success("Source added"); }
      else if (action === "test") {
        const { data } = await api.post("/sources/test-all");
        const failed = data.results.filter(r => r.status === "error").length;
        toast[failed ? "error" : "success"](`${data.checked} sources checked; ${failed} failed. Nothing published.`);
      } else { await api.post("/fetch-all"); toast.success("Import started. New deals will stay in drafts."); }
      await load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <Panel testid="sources-panel" title="Deal sources" desc="Source checks never import or send posts. Imported deals stay private until reviewed."
    action={<div className="flex flex-wrap gap-2"><Button data-testid="test-all-sources-button" disabled={busy || !list.length} className={ghostBtn} onClick={() => run("test")}><Activity className="mr-2 h-4 w-4" />Test all</Button><Button data-testid="fetch-all-button" disabled={busy || !list.length} className={ghostBtn} onClick={() => run("fetch")}><RefreshCw className="mr-2 h-4 w-4" />Import drafts</Button></div>}>
    <form className="mb-5 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); run("add"); }}>
      <select aria-label="Source type" data-testid="add-source-kind-select" value={kind} onChange={e => setKind(e.target.value)} className={`${fieldCls} px-3 sm:w-40`}><option value="telegram">Telegram</option><option value="rss">RSS feed</option><option value="web">Website page</option></select>
      <Input aria-label="Source address" data-testid="add-source-input" required value={value} onChange={e => setValue(e.target.value)} placeholder={kind === "telegram" ? "@channelname or t.me/channel" : "https://site.com/feed"} className={`${fieldCls} min-w-0 flex-1`} />
      <Button type="submit" disabled={busy || !value.trim()} data-testid="add-source-submit-button" className={primaryBtn}><Plus className="mr-1 h-4 w-4" />Add</Button>
    </form>
    {error && <p role="alert" data-testid="sources-load-error" className="mb-3 text-rose-700">{error}</p>}
    <div className="space-y-2">{list.map(s => <SourceRow key={s.id} s={s} reload={load} />)}{!list.length && <p data-testid="sources-empty" className="py-6 text-sm text-slate-500">No sources saved in this database.</p>}</div>
    <Button data-testid="sources-refresh-list" className={`${ghostBtn} mt-4`} onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh status</Button>
  </Panel>;
};