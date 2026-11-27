import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { formatKolkata } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, ghostBtn, fieldCls } from "./Panel";

type LogRow = {
  id: string;
  created_at: string;
  mode?: "url" | "urls" | "text";
  caller?: string | null;
  status: "converted" | "own" | "failed" | "unsupported";
  original: string;
  cleaned?: string | null;
  converted?: string | null;
  store?: string | null;
  service?: string | null;
  cached?: boolean;
  error?: string | null;
  ms?: number;
};

type ApiLogsResponse = {
  status: {
    has_key: boolean;
    hint: string | null;
    uses: number;
    last_used_at: string | null;
  };
  summary: {
    total: number;
    converted: number;
    own: number;
    failed: number;
    unsupported: number;
    cached: number;
    by_service: Record<string, number>;
    by_store: Record<string, number>;
  };
  logs: LogRow[];
};

const STATUS_CLS: Record<string, string> = {
  converted: "bg-emerald-50 text-emerald-700",
  own: "bg-amber-50 text-amber-800",
  failed: "bg-rose-50 text-rose-600",
  unsupported: "bg-slate-100 text-slate-600",
};

const STATUS_LABEL: Record<string, string> = {
  converted: "Converted",
  own: "Already yours",
  failed: "Failed",
  unsupported: "Unsupported",
};

const FILTERS = [
  ["all", "All"],
  ["converted", "Converted"],
  ["own", "Already yours"],
  ["failed", "Failed"],
  ["unsupported", "Unsupported"],
] as const;

const LinkRow = ({ label, url, onCopy }: { label: string; url?: string | null | undefined; onCopy?: ((u: string) => void) | undefined }) => (
  <div className="flex flex-wrap items-center gap-2 break-all font-mono text-[11px] text-slate-600">
    <span className="font-sans font-semibold text-slate-800">{label}:</span>
    {url ? (
      <>
        <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
          {url}
        </a>
        {onCopy && (
          <button
            type="button"
            onClick={() => onCopy(url)}
            title={`Copy ${label.toLowerCase()}`}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        )}
      </>
    ) : (
      <span>—</span>
    )}
  </div>
);

export const ApiConverterDashboardTab = () => {
  const [data, setData] = useState<ApiLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/converter-api/logs");
      setData(res.data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const clear = async () => {
    if (!window.confirm("Clear all external API conversion logs? The total usage counter on your key will stay.")) return;
    try {
      await api.delete("/converter-api/logs");
      toast.success("API conversion logs cleared");
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  };

  const logs = data?.logs ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((row) => {
      if (filter !== "all" && row.status !== filter) return false;
      if (!q) return true;
      return [row.original, row.cleaned, row.converted, row.store, row.service, row.caller, row.error]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [logs, filter, query]);

  const summary = data?.summary;
  const st = data?.status;
  const successRate = summary && summary.total > 0 ? Math.round((summary.converted / summary.total) * 100) : 0;
  const services = Object.entries(summary?.by_service || {}).sort((a, b) => b[1] - a[1]);
  const stores = Object.entries(summary?.by_store || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <Panel
      testid="api-converter-dashboard-panel"
      title="External Website Converter Dashboard"
      desc="Live log of every link sent from your other websites via POST /api/public/v1/convert: what came in, how it was cleaned, and the affiliate link returned."
      action={
        <div className="flex items-center gap-2">
          <Button data-testid="api-dashboard-refresh" className={ghostBtn} onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {logs.length > 0 && (
            <Button data-testid="api-dashboard-clear" className={ghostBtn} onClick={clear}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Clear logs
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-[#F5F2EA] p-3.5">
          <p className="font-mono text-[11px] uppercase text-slate-500">All-time converted</p>
          <p data-testid="api-stat-uses" className="mt-1 text-2xl font-black text-slate-900">
            {st?.uses ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {st?.has_key ? `Key ${st.hint}` : "API key is off"}
            {st?.last_used_at ? ` · last ${formatKolkata(st.last_used_at)}` : ""}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-[#F5F2EA] p-3.5">
          <p className="font-mono text-[11px] uppercase text-slate-500">Recent success rate</p>
          <p data-testid="api-stat-rate" className="mt-1 text-2xl font-black text-emerald-700">
            {successRate}%
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {summary?.converted ?? 0} converted of {summary?.total ?? 0} logged
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-[#F5F2EA] p-3.5">
          <p className="font-mono text-[11px] uppercase text-slate-500">Skipped / Failed</p>
          <p data-testid="api-stat-skipped" className="mt-1 text-2xl font-black text-slate-900">
            {(summary?.own ?? 0) + (summary?.failed ?? 0) + (summary?.unsupported ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {summary?.own ?? 0} already yours · {summary?.failed ?? 0} failed · {summary?.unsupported ?? 0} unsupported
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-[#F5F2EA] p-3.5">
          <p className="font-mono text-[11px] uppercase text-slate-500">Cache hits</p>
          <p data-testid="api-stat-cached" className="mt-1 text-2xl font-black text-violet-700">
            {summary?.cached ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {services.length ? services.map(([name, n]) => `${name}: ${n}`).join(" · ") : "No conversions yet"}
          </p>
        </div>
      </div>

      {stores.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 font-semibold text-slate-600">Top stores:</span>
          {stores.map(([store, count]) => (
            <span key={store} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-700">
              {store} ({count})
            </span>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`api-filter-${key}`}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                filter === key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            data-testid="api-dashboard-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by URL, store, or site…"
            className={`${fieldCls} pl-8 text-xs`}
          />
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((row) => (
          <div
            key={row.id}
            data-testid={`api-log-${row.id}`}
            className="space-y-1.5 rounded-xl border border-slate-200 bg-[#F5F2EA] p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${STATUS_CLS[row.status] || ""}`}>
                {STATUS_LABEL[row.status] || row.status}
              </span>
              <span className="font-semibold">@{row.store || "Unknown"}</span>
              {row.service && row.status === "converted" && (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                  via {row.service}
                </span>
              )}
              {row.cached && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                  cached
                </span>
              )}
              {row.mode && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 font-mono text-[10px] text-sky-800">
                  {row.mode}
                </span>
              )}
              {row.caller && (
                <span className="max-w-xs truncate rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600" title={row.caller}>
                  {row.caller}
                </span>
              )}
              <span className="font-mono text-[11px] text-slate-500">
                {formatKolkata(row.created_at)}
                {row.ms != null ? ` · ${row.ms}ms` : ""}
              </span>
            </div>

            <LinkRow label="Input" url={row.original} />
            <LinkRow label="Clean" url={row.cleaned} />
            <LinkRow label="Your link" url={row.converted} onCopy={row.converted ? copy : undefined} />

            {row.status === "own" && (
              <p className="text-xs text-amber-800">Already your affiliate link — not converted again.</p>
            )}
            {row.error && row.status !== "own" && <p className="text-xs text-rose-600">{row.error}</p>}
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <p data-testid="api-dashboard-empty" className="text-sm text-slate-500">
            {logs.length === 0
              ? "No external API conversions logged yet. Requests to POST /api/public/v1/convert will appear here."
              : "No conversions match your current filter."}
          </p>
        )}
      </div>
    </Panel>
  );
};
