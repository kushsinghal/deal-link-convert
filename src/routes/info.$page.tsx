import { createFileRoute, notFound } from "@tanstack/react-router";
import { CONTACT_EMAIL, INFO_PAGES } from "@/lib/editorial";
export const Route = createFileRoute("/info/$page")({
  loader: ({ params }) => { const data = INFO_PAGES[params.page]; if (!data) throw notFound(); return data; },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.title || "Information"} — DealLoot` }] }),
  component: InfoPage,
});
function InfoPage() {
  const data = Route.useLoaderData();
  return <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16"><a data-testid="info-back-home" href="/" className="text-sm text-slate-600 underline">← DealLoot</a><h1 data-testid="info-title" className="mt-6 text-4xl font-black sm:text-5xl">{data.title}</h1>
    <div className="mt-10 space-y-9">{data.sections.map(([title, text], i) => <section key={title} data-testid={`info-section-${i}`}><h2 className="text-base font-bold md:text-lg">{title}</h2><p className="mt-3 text-sm leading-7 text-slate-700 sm:text-base">{text}</p></section>)}</div>
    <a data-testid="info-email" href={`mailto:${CONTACT_EMAIL}`} className="mt-10 inline-block break-all text-sm font-semibold underline underline-offset-4">{CONTACT_EMAIL}</a>
  </main>;
}