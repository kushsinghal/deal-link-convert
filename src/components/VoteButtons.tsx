// @ts-nocheck
import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";

const voterId = () => {
  let id = localStorage.getItem("dl_voter");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("dl_voter", id); }
  return id;
};
const myVotes = () => { try { return JSON.parse(localStorage.getItem("dl_votes") || "{}"); } catch { return {}; } };

export const VoteButtons = ({ deal }) => {
  const [counts, setCounts] = useState({ up: deal.votes_up || 0, down: deal.votes_down || 0 });
  const [mine, setMine] = useState("none");
  useEffect(() => { setMine(myVotes()[deal.id] || "none"); setCounts({ up: deal.votes_up || 0, down: deal.votes_down || 0 }); }, [deal.id, deal.votes_up, deal.votes_down]);
  const [busy, setBusy] = useState(false);
  const cast = async (v) => {
    const vote = mine === v ? "none" : v;
    setBusy(true);
    try {
      const { data } = await api.post(`/deals/${deal.id}/vote`, { vote, voter: voterId() });
      setCounts({ up: data.votes_up, down: data.votes_down });
      setMine(data.mine);
      localStorage.setItem("dl_votes", JSON.stringify({ ...myVotes(), [deal.id]: data.mine }));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const btn = (v, Icon, n, label) => (
    <button type="button" onClick={() => cast(v)} disabled={busy} aria-label={label} aria-pressed={mine === v} data-testid={`vote-${v}-button-${deal.id}`}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${mine === v ? (v === "up" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-rose-400 bg-rose-50 text-rose-700") : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
      <Icon className="h-3.5 w-3.5" /><span data-testid={`vote-${v}-count-${deal.id}`}>{n}</span>
    </button>
  );
  return <div className="flex items-center gap-1.5" data-testid={`deal-votes-${deal.id}`}>{btn("up", ThumbsUp, counts.up, "Good deal")}{btn("down", ThumbsDown, counts.down, "Not a good deal")}</div>;
};
