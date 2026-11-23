import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Panel, primaryBtn, ghostBtn } from "./Panel";

const sample = (origin: string, key: string) => `curl -X POST ${origin}/api/public/v1/convert \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${key}" \\
  -d '{"url": "https://www.flipkart.com/..."}'`;

export const ConverterApiPanel = () => {
  const [st, setSt] = useState<any>(null), [key, setKey] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/converter-api").then(({ data }) => setSt(data), (e) => toast.error(errMsg(e))); }, []);
  const make = async () => {
    if (st?.has_key && !window.confirm("Make a new key? The old key stops working immediately.")) return;
    setBusy(true);
    try { const { data } = await api.post("/converter-api/key"); setKey(data.key); setSt(data); toast.success("New key ready. Copy it now."); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("Turn off the converter key? Your other website stops converting.")) return;
    try { const { data } = await api.delete("/converter-api/key"); setSt(data); setKey(""); toast.success("Converter key turned off"); } catch (e) { toast.error(errMsg(e)); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copied"));
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return <Panel testid="converter-api-panel" title="Converter for other websites" desc="Your other site sends shop links here and gets your affiliate links back: ExtraPe first, then Sankmo. EarnKaro is never used.">
    <p data-testid="converter-api-status" className="text-xs text-slate-600">
      {!st ? "Loading…" : st.has_key ? <>Key on: <span className="font-mono">{st.hint}</span> · {st.uses} links converted{st.last_used_at ? ` · last used ${new Date(st.last_used_at).toLocaleString()}` : ""}</> : "No key yet. Make one to connect your other website."}
    </p>
    {key && <div data-testid="converter-api-new-key" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-semibold text-amber-900">Copy this key now. It is shown only once.</p>
      <p className="mt-1 break-all font-mono text-xs">{key}</p>
      <Button data-testid="converter-api-copy-key" className={`${ghostBtn} mt-2`} onClick={() => copy(key)}>Copy key</Button>
    </div>}
    <div className="mt-3 flex flex-wrap gap-2">
      <Button data-testid="converter-api-make-key" className={primaryBtn} disabled={busy} onClick={make}>{st?.has_key ? "Make new key" : "Make key"}</Button>
      {st?.has_key && <Button data-testid="converter-api-remove-key" className={ghostBtn} onClick={remove}>Turn off</Button>}
    </div>
    <p className="mt-4 text-xs font-semibold">Request your site sends</p>
    <pre data-testid="converter-api-sample" className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{sample(origin, key || "YOUR_KEY")}</pre>
    <Button data-testid="converter-api-copy-sample" className={`${ghostBtn} mt-2`} onClick={() => copy(sample(origin, key || "YOUR_KEY"))}>Copy example</Button>
    <p className="mt-3 text-xs text-slate-500">Send from your website's server, never from page code in the browser. Up to {st?.max_links ?? 20} links per request, {st?.per_minute ?? 120} requests per minute.</p>
  </Panel>;
};
