import Link from "next/link";
import type { ReactNode } from "react";

export function StatCard({ icon, label, value, href, tone, hint }: { icon: ReactNode; label: string; value: ReactNode; href?: string; tone?: "warn" | "bad"; hint?: string }) {
  const body = (
    <div className="stat">
      <div className="stat-icon" style={tone === "bad" ? { background: "var(--bad-soft)", color: "var(--bad)" } : tone === "warn" ? { background: "var(--warn-soft)", color: "var(--warn)" } : undefined}>{icon}</div>
      <div className="min-w-0">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="text-xs muted">{hint}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="card block hover:border-[var(--brand-line)] transition-colors">{body}</Link> : <div className="card">{body}</div>;
}
