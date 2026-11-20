import { createFileRoute } from "@tanstack/react-router";
import { GUIDES } from "@/lib/editorial";
export const Route = createFileRoute("/guides/")({ head: () => ({ meta: [{ title: "Shopping guides — DealLoot" }, { name: "description", content: "Practical guidance on offer pricing, headphones, gift cards and rewards." }] }), component: GuidesPage });
function GuidesPage() {
  return <main className="mx-auto max-w-7xl px-5 py-12 sm:px-8"><p className="text-sm font-semibold text-emerald-800">DealLoot / Buying well</p><h1 className="mt-3 text-4xl font-black sm:text-5xl">Before you buy.</h1><p className="mt-5 max-w-xl text-slate-600">Clearer prices. Better questions. Purchases that make sense for you.</p>
    <div className="mt-12 grid gap-8 md:grid-cols-3">{GUIDES.map((guide, i) => <article key={guide.slug} className="border-t-2 border-slate-900 pt-5">
      {guide.image && <img data-testid={`guide-image-${guide.slug}`} src={guide.image} alt="Headphones, keyboard and mouse on a desk; illustrative shopping photo" className="mb-5 aspect-[3/2] w-full rounded-lg object-contain bg-white" />}
      <p className="text-xs font-semibold text-emerald-800">0{i + 1} / {guide.read} read</p><h2 className="mt-3 text-lg font-bold"><a data-testid={`guide-link-${guide.slug}`} href={`/guides/${guide.slug}`} className="hover:underline">{guide.title}</a></h2><p className="mt-3 text-sm leading-6 text-slate-600">{guide.summary}</p>
    </article>)}</div>
  </main>;
}