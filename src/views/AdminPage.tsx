// @ts-nocheck — ported from the original app
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourcesTab } from "@/components/admin/SourcesTab";
import { DestinationsTab } from "@/components/admin/DestinationsTab";
import { RulesTab } from "@/components/admin/RulesTab";
import { ManualAddTab } from "@/components/admin/ManualAddTab";
import { SankmoTab } from "@/components/admin/SankmoTab";
import { LogsTab } from "@/components/admin/LogsTab";
import { DealsTab } from "@/components/admin/DealsTab";
import { BulkConvertTab } from "@/components/admin/BulkConvertTab";
import { ConverterHistoryTab } from "@/components/admin/ConverterHistoryTab";

const TABS = [
  ["bulk", "Convert Links", BulkConvertTab],
  ["sources", "Sources", SourcesTab],
  ["destinations", "Telegram Channels", DestinationsTab],
  ["rules", "Rules", RulesTab],
  ["deals", "Deals", DealsTab],
  ["manual-add", "Add Deal", ManualAddTab],
  ["sankmo", "Affiliate Setup", SankmoTab],
  ["logs", "Post Log", LogsTab],
  ["converter-history", "Converter History", ConverterHistoryTab],
];

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-[#B7791F]">Control room</p>
      <h1 className="mt-3 text-4xl font-black sm:text-5xl">Find. Review. Publish.</h1>
      <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
        Choose where deals come from, what counts as a deal, and which Telegram channel gets which kind of drop.
      </p>
      <Tabs defaultValue="bulk" className="mt-8">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-slate-200 bg-white p-1.5">
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k} data-testid={`admin-tab-${k}`}
              className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-950 data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(([k, , Comp]) => (
          <TabsContent key={k} value={k} className="mt-6"><Comp /></TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
