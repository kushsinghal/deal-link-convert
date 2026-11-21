import { useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { BOT_COMMANDS } from "@/lib/bot-commands";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel } from "./Panel";

export const BotCommandsPanel = ({ s, reload }: { s: any; reload: () => void }) => {
  const [busy, setBusy] = useState(false);
  const save = async (patch: any) => { setBusy(true); try { await api.put("/settings", patch); reload(); toast.success("Bot preferences saved"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const sync = async () => { setBusy(true); try { await api.post("/telegram/converter/menu"); toast.success("Telegram command menu updated"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return <Panel testid="bot-commands-panel" title="Bot menu & X posts" desc="/tweets @handle 7 · public posts, without subscribing the handle">
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3 text-sm">Enable tweet lookup<Switch data-testid="bot-tweets-enabled" aria-label="Enable tweet lookup" checked={s.bot_tweets_enabled === true} disabled={busy} onCheckedChange={v => save({ bot_tweets_enabled: v })} /></label>
      <label className="flex items-center justify-between gap-3 text-sm">Anyone can request tweets<Switch data-testid="bot-tweets-public" aria-label="Anyone can request tweets" checked={s.bot_tweets_public !== false} disabled={busy} onCheckedChange={v => save({ bot_tweets_public: v })} /></label>
      <label className="flex items-center justify-between gap-3 text-sm">Default post count<select data-testid="bot-tweets-count" aria-label="Default tweet count" className="rounded-lg border p-2" value={s.bot_tweets_count || 7} disabled={busy} onChange={e => save({ bot_tweets_count: Number(e.target.value) })}>{[5, 6, 7].map(n => <option key={n}>{n}</option>)}</select></label>
      <p data-testid="bot-tweets-limits" className="text-xs text-slate-600">3 requests/minute per chat, 60/hour across the bot. RSS first, configured X access last. Cached posts are labelled; unavailable feeds may return fewer than 7 posts.</p>
      <ul className="space-y-2 border-t pt-3">{BOT_COMMANDS.map(c => <li data-testid={`bot-command-${c.command}`} key={c.command} className="text-xs text-slate-600"><b>/{c.command}</b> — {c.description}</li>)}</ul>
      <Button data-testid="bot-menu-sync" disabled={busy || !s.telegram_converter_token_masked} onClick={sync}>Update Telegram menu</Button>
      <p data-testid="bot-menu-note" className="text-xs text-slate-500">Updating the menu does not change the bot's connected website.</p>
    </div>
  </Panel>;
};