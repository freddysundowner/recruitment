"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CreditCard, History, KeyRound, ListChecks, Mail, ShieldCheck, Users, Wallet } from "lucide-react";

const ICONS = { general: Building2, team: Users, pipeline: ListChecks, payments: Wallet, messages: Mail, security: ShieldCheck, activity: History, activation: KeyRound, billing: CreditCard } as const;

export type SettingsGroup = { title: string; items: { href: string; label: string; icon: keyof typeof ICONS; hint: string }[] };

export function SettingsNav({ groups }: { groups: SettingsGroup[] }) {
  const path = usePathname();
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {groups.map((g) => (
        <div key={g.title} className="settings-group">
          <div className="nav-title">{g.title}</div>
          {g.items.map((i) => {
            const Icon = ICONS[i.icon];
            const on = path === i.href || path.startsWith(i.href + "/");
            return (
              <Link key={i.href} href={i.href} className="settings-link" aria-current={on ? "page" : undefined}>
                <Icon size={17} />
                <span><span className="block font-semibold">{i.label}</span><span className="block text-xs muted settings-hint">{i.hint}</span></span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
