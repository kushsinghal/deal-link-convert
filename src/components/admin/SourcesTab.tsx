// @ts-nocheck
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, Plus, Activity } from "lucide-react";
import { api, errMsg, timeAgo } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel, fieldCls, primaryBtn, ghostBtn } from "./Panel";

const BackupEditor = ({ s, reload }) => {
  const [open, setOpen] = useState(false), [urls, setUrls] = useState((s.backup_urls || []).join("\n")), [xu, setXu] = useState(s.x_username || "");
  if (s.kind === "x") return null;
  const save = async () => {
    try { await api.put(`/sources/${s.id}`, { backup_urls: urls, x_username: xu }); toast.success("Backups saved"); setOpen(false); await reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  if (!open) return <button data-testid={`source-backups-toggle-${s.id}`} onClick={() => setOpen(true)} className="mt-1 text-xs font-semibold text-slate-600 underline">Backups{(s.backup_urls?.length || s.x_username) ? ` (${s.backup_urls?.length || 0} feeds${s.x_username ? ", X @" + s.x_username : ""})` : ""}</button>;
  return <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <textarea data-testid={`source-backup-urls-${s.id}`} rows={3} value={urls} onChange={e => setUrls(e.target.value)} placeholder="Up to 5 backup RSS feed URLs, one per line" className={`${fieldCls} w-full p-2 text-xs`} />
    <Input data-testid={`source-x-username-${s.id}`} value={xu} onChange={e => setXu(e.target.value)} placeholder="X username for the final backup (optional)" className={`${fieldCls} text-xs`} />
    <p className="text-xs text-slate-500">Nitter feeds also try 5 other Nitter mirrors automatically. The X API is used last, at most once every 30 minutes.</p>
    <div className="flex gap-2"><Button size="sm" data-testid={`source-backups-save-${s.id}`} className={primaryBtn} onClick={save}>Save backups</Button><Button size="sm" className={ghostBtn} onClick={() => setOpen(false)}>Cancel</Button></div>
  </div>;
};

const XTest = () => {
  const [u, setU] = useState(""), [res, setRes] = useState(null), [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setRes((await api.post("/x/test", { username: u })).data); } catch (e) { setRes(null); toast.error(errMsg(e)); } finally { setBusy(false); } };
  return <div data-testid="x-test-panel" className="mt-6 rounded-lg border border-slate-200 p-4">
    <p className="mb-2 text-sm font-semibold">Test the X API</p>
    <div className="flex gap-2"><Input data-testid="x-test-username" value={u} onChange={e => setU(e.target.value)} placeholder="@username" className={`${fieldCls} min-w-0 flex-1`} /><Button data-testid="x-test-button" disabled={busy || !u.trim()} className={ghostBtn} onClick={run}>{busy ? "…" : "Read posts"}</Button></div>
    {res && <div data-testid="x-test-result" className="mt-3 space-y-2 text-xs"><p className="font-semibold text-emerald-800">{res.posts} posts read. Nothing imported.</p>{res.sample.map((p, i) => <p key={i} className="break-words rounded bg-slate-50 p-2">{p.text}{p.links.length ? ` · ${p.links.length} link(s)` : ""}</p>)}</div>}
  </div>;
};

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
        else toast.success(action === "test" ? data.message : `${data.fetched} posts scanned, ${data.new_deals} new deals added`);
      }
      await reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <div data-testid={`source-row-${s.id}`} className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
    <div className="min-w-0 basis-full flex-1 sm:basis-0">
      <p data-testid={`source-name-${s.id}`} className="break-words font-semibold">{s.name} <span className="text-xs font-normal text-slate-500">{s.kind}</span></p>
      <p data-testid={`source-url-${s.id}`} className="break-all text-xs text-slate-500">{s.value}</p>
      <p data-testid={`source-status-${s.id}`} className="mt-2 break-words text-xs text-slate-600">Last import: {timeAgo(s.last_fetched_at)} · {s.total_deals || 0} deals imported</p>
      {s.last_via && <p data-testid={`source-via-${s.id}`} className="mt-1 break-all text-xs text-amber-700">Main feed failed, last read from backup: {s.last_via}</p>}
      <BackupEditor s={s} reload={reload} />
      {s.last_error && <p role="alert" data-testid={`source-import-error-${s.id}`} className="mt-1 break-words text-xs text-rose-700">Import error: {s.last_error}</p>}
      {s.health && <p data-testid={`source-health-${s.id}`} className={`mt-2 break-words text-xs ${s.health.status === "error" ? "text-rose-700" : "text-emerald-800"}`}>{s.health.status === "ok" ? "Readable" : s.health.status === "empty" ? "No posts" : "Check failed"} · {s.health.message} · {timeAgo(s.health.checked_at)}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Switch aria-label={`Enable ${s.name}`} data-testid={`source-toggle-${s.id}`} disabled={busy} checked={s.enabled} onCheckedChange={async enabled => { try { await api.put(`/sources/${s.id}`, { enabled }); await reload(); } catch (e) { toast.error(errMsg(e)); } }} />
      <Button size="sm" data-testid={`source-test-${s.id}`} className={ghostBtn} onClick={() => act("test")} disabled={busy}><Activity className="mr-1 h-4 w-4" />Test</Button>
      <Button size="icon" title="Fetch now" aria-label="Fetch now" data-testid={`source-fetch-${s.id}`} className={ghostBtn} onClick={() => act("fetch")} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /></Button>
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
      } else { await api.post("/fetch-all"); toast.success("Fetch started. New deals will appear shortly."); }
      await load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <Panel testid="sources-panel" title="Deal sources" desc="Sources are fetched automatically every 15 minutes. “Test all” only checks they are readable; “Fetch now” imports new deals immediately."
    action={<div className="flex flex-wrap gap-2"><Button data-testid="test-all-sources-button" disabled={busy || !list.length} className={ghostBtn} onClick={() => run("test")}><Activity className="mr-2 h-4 w-4" />Test all</Button><Button data-testid="fetch-all-button" disabled={busy || !list.length} className={ghostBtn} onClick={() => run("fetch")}><RefreshCw className="mr-2 h-4 w-4" />Fetch now</Button></div>}>
    <form className="mb-5 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); run("add"); }}>
      <select aria-label="Source type" data-testid="add-source-kind-select" value={kind} onChange={e => setKind(e.target.value)} className={`${fieldCls} px-3 sm:w-40`}><option value="telegram">Telegram</option><option value="rss">RSS feed</option><option value="web">Website page</option><option value="x">X account</option></select>
      <Input aria-label="Source address" data-testid="add-source-input" required value={value} onChange={e => setValue(e.target.value)} placeholder={kind === "telegram" ? "@channelname or t.me/channel" : kind === "x" ? "@username (reads via X API)" : "https://site.com/feed"} className={`${fieldCls} min-w-0 flex-1`} />
      <Button type="submit" disabled={busy || !value.trim()} data-testid="add-source-submit-button" className={primaryBtn}><Plus className="mr-1 h-4 w-4" />Add</Button>
    </form>
    {error && <p role="alert" data-testid="sources-load-error" className="mb-3 text-rose-700">{error}</p>}
    <div className="space-y-2">{list.map(s => <SourceRow key={s.id} s={s} reload={load} />)}{!list.length && <p data-testid="sources-empty" className="py-6 text-sm text-slate-500">No sources saved in this database.</p>}</div>
    <Button data-testid="sources-refresh-list" className={`${ghostBtn} mt-4`} onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh status</Button>
    <XTest />
  </Panel>;
};