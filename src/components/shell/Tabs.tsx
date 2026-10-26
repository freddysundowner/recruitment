"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The sections that share one place in the sidebar. The current one is highlighted. */
export function Tabs({ items }: { items: { href: string; label: string; match?: string[]; badge?: number }[] }) {
  const path = usePathname();
  const on = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/"));
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((t) => (
        <Link key={t.href} href={t.href} className="tab" aria-current={(t.match ?? [t.href]).some(on) ? "page" : undefined}>
          {t.label}{t.badge ? <span className="badge badge-warn">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
