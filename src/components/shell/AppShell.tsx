"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, Briefcase, Building2, CalendarCheck, ChevronDown, CreditCard, FileCheck2, KanbanSquare, LayoutDashboard,
  ListChecks, LogOut, Mail, Menu, MessageSquareWarning, Search, Settings, ShieldCheck, Users, Wallet, X,
} from "lucide-react";

const ICONS = {
  dashboard: LayoutDashboard, candidates: Users, pipeline: KanbanSquare, jobs: Briefcase, employers: Building2, verify: FileCheck2,
  followup: CalendarCheck, complaints: MessageSquareWarning, messages: Mail, finance: Wallet, reports: BarChart3, billing: CreditCard, settings: Settings, todo: ListChecks,
} as const;

export type NavItem = {
  href: string; label: string; icon: keyof typeof ICONS; badge?: number; tone?: "warn" | "bad";
  /** Other places that belong to this item, so it stays highlighted while you are on one of them. */
  match?: string[];
};
export type NavGroup = { title: string; items: NavItem[] };

type Props = {
  groups: NavGroup[];
  brand: string;
  user: { name: string; role: string };
  logout: () => Promise<void>;
  children: React.ReactNode;
};

export function AppShell({ groups, brand, user, logout, children }: Props) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  const active = (n: NavItem) => (n.match ?? [n.href]).some(on);

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className="sidebar" data-open={open}>
        <div className="brand-row">
          <div className="brand-mark">{brand.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <div className="font-bold leading-tight truncate">{brand}</div>
            <div className="text-xs muted">Recruitment workspace</div>
          </div>
          <button className="btn btn-ghost btn-sm ml-auto md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={16} /></button>
        </div>
        <nav className="pb-6">
          {groups.map((g) => (
            <div key={g.title} className="nav-group">
              {g.title && <div className="nav-title">{g.title}</div>}
              {g.items.map((n) => {
                const Icon = ICONS[n.icon];
                return (
                  <Link key={n.href} href={n.href} className="nav-link" aria-current={active(n) ? "page" : undefined} onClick={() => setOpen(false)}>
                    <Icon size={17} />
                    <span className="flex-1">{n.label}</span>
                    {n.badge ? <span className={`badge ${n.tone === "bad" ? "badge-bad" : "badge-warn"}`}>{n.badge}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="topbar no-print">
          <button className="btn btn-ghost btn-sm md:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <form action="/candidates" className="search">
            <Search size={16} />
            <input name="q" className="input" placeholder="Search candidates by name, phone or ID" aria-label="Search candidates" />
          </form>
          <div className="ml-auto menu">
            <details>
              <summary className="flex items-center gap-2">
                <span className="avatar">{initials}</span>
                <span className="hidden sm:block text-left leading-tight">
                  <span className="block font-semibold text-[13px]">{user.name}</span>
                  <span className="block text-xs muted">{user.role}</span>
                </span>
                <ChevronDown size={15} className="muted" />
              </summary>
              <div className="menu-panel">
                <Link href="/account/security" className="menu-item"><ShieldCheck size={16} /> Account security</Link>
                <form action={logout}><button className="menu-item"><LogOut size={16} /> Sign out</button></form>
              </div>
            </details>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
