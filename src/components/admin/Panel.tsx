import type { ReactNode } from "react";
export const Panel = ({ title, desc, children, testid, action }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; testid: string; action?: ReactNode }) => (
  <section data-testid={testid} className="min-w-0 rounded-2xl border border-slate-300 bg-white p-5 sm:p-7">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {desc && <p className="mt-1 text-sm text-slate-600">{desc}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const fieldCls = "h-10 rounded-xl border-slate-300 bg-[#F5F2EA] text-slate-900 placeholder:text-slate-400";
export const primaryBtn = "rounded-xl bg-[#FF5A1F] font-bold text-white hover:bg-[#ff6d38]";
export const ghostBtn = "rounded-xl border border-slate-300 bg-transparent text-slate-800 hover:bg-slate-200 hover:text-slate-950";
