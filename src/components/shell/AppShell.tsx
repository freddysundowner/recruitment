"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BookOpen, Briefcase, Building2, CalendarCheck, ChevronDown, CreditCard, FileCheck2, KanbanSquare, LayoutDashboard, LayoutGrid,
  ListChecks, LogOut, Mail, MessageSquareWarning, Plus, Search, Settings, ShieldCheck, Users, Wallet, X,
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
  /** The main thing to add on a phone, shown as a round button: for example a new candidate. */
  fab?: { href: string; label: string };
  children: React.ReactNode;
};

// On a phone these four sit in the bottom bar; everything else is under "More".
const TABS = ["/", "/todo", "/candidates", "/pipeline"];
const FAB_PAGES = ["/", "/todo", "/candidates", "/pipeline"];

export function AppShell({ groups, brand, user, logout, fab, children }: Props) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  const active = (n: NavItem) => (n.match ?? [n.href]).some(on);
  const all = groups.flatMap((g) => g.items);
  const tabs = TABS.map((h) => all.find((n) => n.href === h)).filter((n): n is NavItem => Boolean(n));
  const rest = all.filter((n) => !TABS.includes(n.href));
  const restActive = rest.some(active);
  const moreBadge = rest.reduce((s, n) => s + (n.badge ?? 0), 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">{brand.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <div className="font-bold leading-tight truncate">{brand}</div>
            <div className="text-xs muted">Recruitment workspace</div>
          </div>
        </div>
        <nav className="pb-6">
          {groups.map((g) => (
            <div key={g.title} className="nav-group">
              {g.title && <div className="nav-title">{g.title}</div>}
              {g.items.map((n) => {
                const Icon = ICONS[n.icon];
                return (
                  <Link key={n.href} href={n.href} className="nav-link" aria-current={active(n) ? "page" : undefined}>
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
          {/* Phone: the agency's name, a search button and the account menu, like the top of an app. */}
          <div className="mobile-only brand-compact">
            <div className="brand-mark" style={{ width: 30, height: 30, fontSize: 14 }}>{brand.slice(0, 1).toUpperCase()}</div>
            <div className="font-bold truncate">{brand}</div>
          </div>
          <button className="mobile-only icon-btn ml-auto" onClick={() => setSearching(true)} aria-label="Search candidates"><Search size={20} /></button>

          <form action="/candidates" className="search" data-open={searching}>
            <Search size={16} />
            <input name="q" className="input" placeholder="Search candidates by name, phone or ID" aria-label="Search candidates" autoFocus={searching} />
            <button type="button" className="mobile-only icon-btn search-close" onClick={() => setSearching(false)} aria-label="Close search"><X size={18} /></button>
          </form>

          <div className="desk-menu menu ml-auto">
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
                <Link href="/guide" className="menu-item"><BookOpen size={16} /> How to use this</Link>
                <Link href="/account/security" className="menu-item"><ShieldCheck size={16} /> Account security</Link>
                <form action={logout}><button className="menu-item"><LogOut size={16} /> Sign out</button></form>
              </div>
            </details>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>

      {fab && FAB_PAGES.includes(path) && (
        <Link href={fab.href} className="fab mobile-only no-print" aria-label={fab.label}><Plus size={26} strokeWidth={2.4} /></Link>
      )}

      {/* The bottom bar of the phone app. */}
      <nav className="tabbar mobile-only no-print" aria-label="Main">
        {tabs.map((n) => {
          const Icon = ICONS[n.icon];
          return (
            <Link key={n.href} href={n.href} className="tab-item" aria-current={active(n) && !more ? "page" : undefined} onClick={() => setMore(false)}>
              <span className="tab-icon"><Icon size={22} />{n.badge ? <span className="tab-badge">{n.badge > 99 ? "99+" : n.badge}</span> : null}</span>
              <span>{n.href === "/pipeline" ? "Pipeline" : n.label}</span>
            </Link>
          );
        })}
        <button className="tab-item" aria-current={more || restActive ? "page" : undefined} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          <span className="tab-icon"><LayoutGrid size={22} />{moreBadge ? <span className="tab-badge">{moreBadge > 99 ? "99+" : moreBadge}</span> : null}</span>
          <span>More</span>
        </button>
      </nav>

      {more && (
        <>
          <div className="scrim" onClick={() => setMore(false)} />
          <div className="sheet mobile-only" role="dialog" aria-label="More">
            <div className="sheet-handle" />
            <div className="flex items-center gap-3 px-1 pb-3">
              <span className="avatar" style={{ width: 40, height: 40 }}>{initials}</span>
              <div className="min-w-0"><div className="font-bold truncate">{user.name}</div><div className="muted text-xs">{user.role} · {brand}</div></div>
            </div>
            <div className="sheet-grid">
              {rest.map((n) => {
                const Icon = ICONS[n.icon];
                return (
                  <Link key={n.href} href={n.href} className="sheet-tile" aria-current={active(n) ? "page" : undefined} onClick={() => setMore(false)}>
                    <span className="tab-icon"><Icon size={24} />{n.badge ? <span className="tab-badge">{n.badge}</span> : null}</span>
                    <span>{n.label}</span>
                  </Link>
                );
              })}
              <Link href="/guide" className="sheet-tile" onClick={() => setMore(false)}><span className="tab-icon"><BookOpen size={24} /></span><span>Guide</span></Link>
              <Link href="/account/security" className="sheet-tile" onClick={() => setMore(false)}><span className="tab-icon"><ShieldCheck size={24} /></span><span>Security</span></Link>
            </div>
            <form action={logout} className="mt-3"><button className="btn w-full" style={{ minHeight: 46 }}><LogOut size={16} /> Sign out</button></form>
          </div>
        </>
      )}
    </div>
  );
}
