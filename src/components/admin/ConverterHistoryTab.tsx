// @ts-nocheck
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatKolkata } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Panel, ghostBtn } from "./Panel";

const STATUS = { converted: "bg-emerald-50 text-emerald-700", unchanged: "bg-amber-50 text-amber-700", failed: "bg-rose-50 text-rose-600", repeat: "bg-slate-100 text-slate-700" };
const PLACE = { channel: "Channel", group: "Group", supergroup: "Group", private: "Private chat" };
const secs = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);

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
      <div className="space-y-2">
        {logs.map((l) => (
          <div key={l.id} data-testid={`converter-log-${l.id}`} className="space-y-1.5 rounded-xl border border-slate-200 bg-[#F5F2EA] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${STATUS[l.status] || ""}`}>{l.status}</span>
              <span className="font-semibold">@{l.store}</span>
              <span data-testid={`converter-log-chat-${l.id}`} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">{PLACE[l.chat_type] || "Chat"}: {l.chat_title || l.chat_id}</span>
              {l.service && l.status === "converted" && <span data-testid={`converter-log-service-${l.id}`} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">via {l.service}</span>}
              <span className="font-mono text-[11px] text-slate-500">Sent {formatKolkata(l.message_at)} · replied {formatKolkata(l.replied_at)} · took {secs(l.total_ms)}</span>
            </div>
            <LinkRow label="Pasted" url={l.original} testid={`converter-log-original-${l.id}`} />
            <LinkRow label="Clean" url={l.cleaned} testid={`converter-log-clean-${l.id}`} />
            <LinkRow label="Your link" url={l.converted} testid={`converter-log-converted-${l.id}`} />
            {l.own && l.status !== "repeat" && <p className="text-xs text-slate-600">Already your affiliate link — kept as it is, not converted again.</p>}
            {l.error && <p className="text-xs text-rose-600">{l.error}</p>}
          </div>
        ))}
        {logs.length === 0 && <p data-testid="converter-history-empty" className="text-sm text-slate-500">No links converted through the Telegram bot yet.</p>}
      </div>
    </Panel>
  );
};
