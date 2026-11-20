import { CONTACT_EMAIL } from "@/lib/editorial";
export const SiteFooter = () => <footer className="mt-12 border-t border-slate-200 bg-white">
  <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-8 md:grid-cols-2">
    <div><p className="font-display text-xl font-bold">DealLoot</p><p data-testid="footer-disclosure" className="mt-3 max-w-md text-sm leading-relaxed text-slate-600">Some shopping links may earn us a commission. Prices and eligibility can change; check the retailer before buying.</p><a data-testid="footer-contact-email" href={`mailto:${CONTACT_EMAIL}`} className="mt-3 inline-block break-all text-sm underline underline-offset-4">{CONTACT_EMAIL}</a></div>
    <nav aria-label="Site information" className="grid grid-cols-2 content-start gap-4 text-sm">{[["about", "About"], ["contact", "Contact"], ["editorial", "Editorial standards"], ["disclosure", "Affiliate disclosure"], ["privacy", "Privacy"], ["terms", "Terms"]].map(([slug, label]) => <a data-testid={`footer-${slug}`} key={slug} href={`/info/${slug}`} className="transition-colors hover:text-orange-700">{label}</a>)}</nav>
  </div>
</footer>;