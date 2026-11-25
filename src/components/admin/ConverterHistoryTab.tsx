// @ts-nocheck
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatKolkata } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Panel, ghostBtn } from "./Panel";

const STATUS = { converted: "bg-emerald-50 text-emerald-700", unchanged: "bg-amber-50 text-amber-700", failed: "bg-rose-50 text-rose-600", repeat: "bg-slate-100 text-slate-700", deleted: "bg-orange-50 text-orange-700" };
const PLACE = { channel: "Channel", group: "Group", supergroup: "Group", private: "Private chat" };
const secs = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);

const avg = (rows, key) => secs(rows.reduce((n, r) => n + (r[key] || 0), 0) / rows.length);
const timed = (logs, status) => logs.filter((l) => l.status === status && l.deliver_ms != null).slice(0, 50);

const Averages = ({ logs }) => {
  const made = timed(logs, "converted"), gone = timed(logs, "repeat");
  if (!made.length && !gone.length) return <p data-testid="converter-timing-summary" className="mb-3 text-xs text-slate-500">Timing averages appear here after the next posts.</p>;
  return (
    <div data-testid="converter-timing-summary" className="mb-3 space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
      {made.length > 0 && <p data-testid="converter-timing-converted"><b>Last {made.length} converted links:</b> average {avg(made, "total_ms")} from post to converted — delivery to the site {avg(made, "deliver_ms")}, opening short links {avg(made, "open_ms")}, converter {avg(made, "service_ms")}, Telegram edit {avg(made, "telegram_ms")}.</p>}
      {gone.length > 0 && <p data-testid="converter-timing-deleted"><b>Last {gone.length} repeats:</b> average {avg(gone, "total_ms")} from post to delete order — delivery to the site {avg(gone, "deliver_ms")}. Telegram does not report when the post actually disappears.</p>}
      <p className="text-slate-500">Times start at Telegram's own time stamp, which is in whole seconds, so each figure can be off by up to one second.</p>
    </div>
  );
};

const LinkRow = ({ label, url, testid }) => (
  <p className="break-all font-mono text-[11px] text-slate-600"><span className="mr-1 font-sans font-semibold text-slate-800">{label}:</span>
    {url ? <a data-testid={testid} href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{url}</a> : "—"}</p>
);

export const ConverterHistoryTab = () => {
  const [logs, setLogs] = useState([]);
  const load = () => api.get("/converter-logs").then((r) => setLogs(r.data));
  useEffect(() => { load(); }, []);
  return (
    <Panel testid="converter-history-panel" title="Converter history" desc="Every link sent to your Telegram converter bot: where it was posted, which converter made the link, the link you pasted, the clean link without tracking, and your affiliate link."
      action={<Button data-testid="converter-history-refresh" className={ghostBtn} onClick={load}><RefreshCw className="h-4 w-4" /></Button>}>
      <Averages logs={logs} />
      <div className="space-y-2">
        {logs.map((l) => (
          <div key={l.id} data-testid={`converter-log-${l.id}`} className="space-y-1.5 rounded-xl border border-slate-200 bg-[#F5F2EA] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${STATUS[l.status] || ""}`}>{l.status}</span>
              <span className="font-semibold">@{l.store}</span>
              <span data-testid={`converter-log-chat-${l.id}`} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">{PLACE[l.chat_type] || "Chat"}: {l.chat_title || l.chat_id}</span>
              {l.service && l.status === "converted" && <span data-testid={`converter-log-service-${l.id}`} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">via {l.service}</span>}
              {l.reused && <span data-testid={`converter-log-reused-${l.id}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">reused link</span>}
              <span className="font-mono text-[11px] text-slate-500">Sent {formatKolkata(l.message_at)} · replied {formatKolkata(l.replied_at)} · took {secs(l.total_ms)}</span>
            </div>
            {l.deliver_ms != null && <p data-testid={`converter-log-timing-${l.id}`} className="font-mono text-[11px] text-slate-600">Delivery {secs(l.deliver_ms)}{l.open_ms ? ` · opening link ${secs(l.open_ms)}` : ""}{l.status === "converted" ? ` · converter ${l.reused ? "0 (reused)" : secs(l.service_ms)}` : ""}{l.telegram_ms ? ` · Telegram ${secs(l.telegram_ms)}` : ""} · total {secs(l.total_ms)}</p>}
            <LinkRow label="Pasted" url={l.original} testid={`converter-log-original-${l.id}`} />
            <LinkRow label="Clean" url={l.cleaned} testid={`converter-log-clean-${l.id}`} />
            <LinkRow label="Your link" url={l.converted} testid={`converter-log-converted-${l.id}`} />
            {l.own && l.status !== "repeat" && <p className="text-xs text-slate-600">Already your affiliate link — kept as it is, not converted again.</p>}
            {l.reposted && <p data-testid={`converter-log-reposted-${l.id}`} className="text-xs text-slate-600">The original post was already gone, so the bot posted the converted message as a new post.</p>}
            {l.error && <p className="text-xs text-rose-600">{l.error}</p>}
          </div>
        ))}
        {logs.length === 0 && <p data-testid="converter-history-empty" className="text-sm text-slate-500">No links converted through the Telegram bot yet.</p>}
      </div>
    </Panel>
  );
};
