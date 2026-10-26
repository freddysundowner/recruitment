import Link from "next/link";
import { getCandidateCtx, requireAgency } from "@/lib/portal-session";
import { Suspense } from "react";
import { NextStepHost } from "@/components/NextStepHost";
import { candidateLogout } from "@/app/actions/portal";

import type { Metadata } from "next";

// Private pages: keep them out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PortalLayout({ children, params }: LayoutProps<"/c/[slug]">) {
  const { slug } = await params;
  const agency = await requireAgency(slug);
  const me = await getCandidateCtx(agency.id);
  const brand = /^#[0-9a-f]{6}$/i.test(agency.brand_color ?? "") ? agency.brand_color! : undefined;
  const name = agency.brand_name || agency.name;
  const nav = [
    ["home", "Home"], ["jobs", "Jobs"], ["documents", "Documents"], ["payments", "Payments"], ["help", "Help"], ["me", "Profile"],
  ];
  return (
    <div className="min-h-screen" style={brand ? ({ "--brand": brand } as React.CSSProperties) : undefined}>
      <header className="bg-[var(--brand)] text-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href={`/c/${slug}`} className="font-bold text-lg">{name}</Link>
          {me && (
            <form action={candidateLogout.bind(null, slug)}>
              <button className="text-sm underline">Sign out</button>
            </form>
          )}
        </div>
        {me && (
          <nav className="max-w-3xl mx-auto px-2 flex overflow-x-auto">
            {nav.map(([p, l]) => (
              <Link key={p} href={`/c/${slug}/${p}`} className="px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-white/15">{l}</Link>
            ))}
          </nav>
        )}
      </header>
      <main className="max-w-3xl mx-auto p-4 grid gap-4"><Suspense><NextStepHost slug={slug} /></Suspense>{children}</main>
      <footer className="max-w-3xl mx-auto px-4 pb-8 text-xs muted">
        Never pay anyone in cash without a receipt from {name}. Your details are kept private and used only to find you work.
      </footer>
    </div>
  );
}
