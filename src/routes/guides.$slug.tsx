import { createFileRoute, notFound } from "@tanstack/react-router";
import { GUIDES } from "@/lib/editorial";
export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => { const guide = GUIDES.find(g => g.slug === params.slug); if (!guide) throw notFound(); return guide; },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.title || "Guide"} — DealLoot` }, { name: "description", content: loaderData?.summary || "" }] }), component: GuidePage,
});
function GuidePage() {
  const guide = Route.useLoaderData();
  return <article className="mx-auto max-w-3xl px-5 py-12"><a data-testid="guide-back" href="/guides" className="text-sm text-slate-600 underline">← All shopping guides</a><p className="mt-8 text-xs font-semibold text-emerald-800">GENERAL BUYING GUIDE · {guide.read} read</p><h1 data-testid="guide-title" className="mt-4 text-4xl font-black leading-tight sm:text-5xl">{guide.title}</h1><p className="mt-5 text-slate-600">{guide.summary}</p>
    <div className="mt-10 space-y-9">{guide.sections.map(([title, text], i) => <section data-testid={`guide-section-${i}`} key={title}><h2 className="text-base font-bold md:text-lg">{title}</h2><p className="mt-3 text-sm leading-7 text-slate-700 sm:text-base">{text}</p></section>)}</div>
    <a data-testid="guide-editorial-policy" href="/info/editorial" className="mt-10 inline-block text-sm underline">Our editorial standards</a>
  </article>;
}