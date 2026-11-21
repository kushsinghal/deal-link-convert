import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Panel, fieldCls, primaryBtn, ghostBtn } from "./Panel";

export const AmazonTagPanel = ({ s, setS }: { s: any; setS: (s: any) => void }) => {
  const [tag, setTag] = useState(s.amazon_tag || ""), [busy, setBusy] = useState(false);
  useEffect(() => { setTag(s.amazon_tag || ""); }, [s.amazon_tag]);
  const save = async (enable = false) => {
    setBusy(true);
    try {
      const { data } = await api.put("/settings", { amazon_tag: tag.trim(), ...(enable ? { affiliate_chains: { ...(s.affiliate_chains || {}), Amazon: ["amazon", "extrape", "earnkaro"] } } : {}) });
      setS(data); toast.success(enable ? "Your Amazon.in tag is now first in the Amazon route" : "Amazon tag saved");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <Panel testid="amazon-tag-panel" title="My Amazon Associates" desc="Amazon.in tracking ID · optional">
    <label htmlFor="amazon-tag" className="text-xs font-semibold">Your issued tracking tag</label>
    <Input id="amazon-tag" data-testid="amazon-tag-input" className={`${fieldCls} mt-2`} value={tag} onChange={e => setTag(e.target.value)} placeholder="yourtag-21" maxLength={64} />
    <div className="mt-3 flex flex-wrap gap-2">
      <Button data-testid="amazon-tag-save" className={ghostBtn} disabled={busy} onClick={() => save()}>Save tag</Button>
      <Button data-testid="amazon-tag-enable" className={primaryBtn} disabled={busy || !tag.trim()} onClick={() => save(true)}>Use my tag for Amazon</Button>
    </div>
    <p data-testid="amazon-tag-status" className="mt-3 text-xs text-slate-600">{s.amazon_tag ? "Tag saved. The Amazon store route below decides whether it is used." : "No tag saved. You can add it later; converter routes stay available."}</p>
    <p data-testid="amazon-tag-disclaimer" className="mt-2 text-xs text-slate-500">Only Amazon.in links are tagged. An issued tag does not verify account approval or commission eligibility.</p>
    <a data-testid="amazon-link-checker" href="https://affiliate-program.amazon.in/home/tools/linkchecker" target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold underline">Amazon Link Checker ↗</a>
  </Panel>;
};