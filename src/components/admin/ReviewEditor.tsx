import { useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
export const ReviewEditor = ({ deal, reload }: { deal: any; reload: () => void }) => {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [title, setTitle] = useState(deal.title), [note, setNote] = useState(deal.editorial_note || "");
  const save = async (publish: boolean) => {
    setBusy(true);
    try { await api.put(`/deals/${deal.id}/review`, { title, editorial_note: note, publish, review_confirmed: confirmed }); toast.success(publish ? "Deal published" : "Draft saved"); setOpen(false); reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <div className="w-full border-t border-slate-200 pt-3">
    <div className="flex items-center justify-between gap-3"><span data-testid={`review-status-${deal.id}`} className={`text-xs font-semibold ${deal.publication_status === "published" ? "text-emerald-800" : "text-amber-800"}`}>{deal.publication_status === "published" ? "Published" : "Draft · private"}</span>
      <Button data-testid={`review-open-${deal.id}`} variant="outline" onClick={() => setOpen(!open)}>{open ? "Close review" : "Review & edit"}</Button></div>
    {open && <div data-testid={`review-form-${deal.id}`} className="mt-4 space-y-3">
      <label className="block text-sm font-semibold">Title<Input data-testid={`review-title-${deal.id}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={180} /></label>
      <label className="block text-sm font-semibold">Your original buying advice<Textarea data-testid={`review-note-${deal.id}`} value={note} onChange={e => setNote(e.target.value)} maxLength={5000} rows={5} placeholder="Who is this suitable for? What are the limitations, alternatives and offer conditions?" /></label>
      <label className="flex items-start gap-2 text-xs leading-relaxed"><input data-testid={`review-confirm-${deal.id}`} type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />I checked the retailer, price and offer conditions; my commentary is original; I have permission to use the text and images. I am not claiming hands-on testing I haven't done.</label>
      <div className="flex flex-wrap gap-2"><Button variant="outline" data-testid={`review-draft-${deal.id}`} disabled={busy} onClick={() => save(false)}>Save as draft</Button><Button data-testid={`review-publish-${deal.id}`} disabled={busy || !confirmed || note.trim().length < 80} onClick={() => save(true)}>Publish reviewed deal</Button></div>
    </div>}
  </div>;
};