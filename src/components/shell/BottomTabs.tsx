"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, FileText, LayoutDashboard, LifeBuoy, Home, PlusCircle, Receipt, Wallet } from "lucide-react";

const ICONS = { home: Home, jobs: Briefcase, documents: FileText, payments: Wallet, help: LifeBuoy, overview: LayoutDashboard, request: PlusCircle, invoices: Receipt } as const;

export type TabDef = { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean };

/** The bottom bar of the candidate and employer pages on a phone. It is hidden on larger screens, which keep their top menu. */
export function BottomTabs({ items }: { items: TabDef[] }) {
  const path = usePathname();
  return (
    <nav className="tabbar mobile-only no-print" aria-label="Main">
      {items.map((t) => {
        const Icon = ICONS[t.icon];
        const on = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href} className="tab-item" aria-current={on ? "page" : undefined}>
            <span className="tab-icon"><Icon size={22} /></span>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
