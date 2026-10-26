import Link from "next/link";
import { notFound } from "next/navigation";
import { isSingleInstall } from "@/lib/plan";
import { requirePlatform } from "@/lib/platform";
import { platformLogout } from "@/app/actions/platform";

export default async function ConsoleLayout({ children }: LayoutProps<"/platform">) {
  if (isSingleInstall()) notFound(); // a single install has no platform layer
  const admin = await requirePlatform();
  const nav = [["/platform", "Overview"], ["/platform/tenants", "Agencies"], ["/platform/payments", "Payments"], ["/platform/plans", "Plans"], ["/platform/admins", "Administrators"], ["/platform/security", "My security"]];
  return (
    <div className="min-h-screen">
      <header className="bg-[#14181f] text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="font-bold">Platform console</div>
          <div className="flex items-center gap-3 text-sm"><span>{admin.name}</span><form action={platformLogout}><button className="underline">Sign out</button></form></div>
        </div>
        <nav className="max-w-6xl mx-auto px-2 flex overflow-x-auto">
          {nav.map(([h, l]) => <Link key={h} href={h} className="px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-white/15">{l}</Link>)}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto p-4 grid gap-4">
        {!admin.totpEnabled && <div className="alert">Turn on two-step sign-in under <Link className="underline" href="/platform/security">My security</Link>. Until you do, you can look but not change anything.</div>}
        {children}
      </main>
    </div>
  );
}
