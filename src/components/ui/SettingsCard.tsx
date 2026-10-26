import type { ReactNode } from "react";

/** One setting or group of settings: a title, a plain-words explanation, then the controls. */
export function SettingsCard({ title, desc, badge, children, id }: { title: string; desc?: ReactNode; badge?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card" id={id} style={{ scrollMarginTop: 80 }}>
      <div className="section-head mb-3">
        <div className="flex items-center gap-2 flex-wrap"><h2 className="h2">{title}</h2>{badge}</div>
        {desc && <p className="muted text-[13px]">{desc}</p>}
      </div>
      {children}
    </section>
  );
}
