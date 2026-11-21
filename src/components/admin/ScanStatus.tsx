// @ts-nocheck
import { useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/api";
import { formatKolkata } from "@/lib/utils";

const Cell = ({ label, value, sub, testid }) => (
  <div className="rounded-xl border border-slate-200 bg-[#F5F2EA] p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p data-testid={testid} className="mt-1 text-sm font-bold">{value}</p>
    {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
  </div>
);

export const ScanStatus = ({ compact = false }) => {
  const [st, setSt] = useState(null);
  useEffect(() => {
    const load = () => api.get("/scan-status").then((r) => setSt(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  if (!st) return null;
  const overdue = st.next_scan_at && new Date(st.next_scan_at).getTime() < Date.now() - 120000;
  const next = st.running ? "Running now" : !st.next_scan_at ? "After the first scan" : overdue ? "Overdue" : formatKolkata(st.next_scan_at);
  const cells = [
    <Cell key="last" testid="scan-status-last" label="Last scan" value={st.last_scan_at ? timeAgo(st.last_scan_at) : "Never"} sub={st.last_scan_at ? formatKolkata(st.last_scan_at) : ""} />,
    <Cell key="next" testid="scan-status-next" label="Next expected scan" value={next} sub={overdue ? "No ping received. Check your scheduler (cron-job.org)." : ""} />,
  ];
  if (!compact) cells.push(
    <Cell key="deal" testid="scan-status-latest-deal" label="Last deal came" value={st.latest_deal_at ? timeAgo(st.latest_deal_at) : "No deals yet"} sub={st.latest_deal_at ? formatKolkata(st.latest_deal_at) : ""} />,
    <Cell key="4h" testid="scan-status-fetched-4h" label="Deals fetched in last 4 hours" value={st.fetched_4h} />,
  );
  return <div data-testid="scan-status" className={`grid gap-2 ${compact ? "mt-3 grid-cols-1" : "mb-5 grid-cols-2 lg:grid-cols-4"}`}>{cells}</div>;
};
