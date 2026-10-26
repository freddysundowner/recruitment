import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";
import { formatMoney } from "@/lib/money";

export default async function Overview() {
  await requirePlatform();
  const [{ platform_overview: o }] = await sql`SELECT platform_overview()`;
  const stat = (label: string, value: string | number, tone?: string) => (
    <div className="card"><div className="muted text-xs font-semibold">{label}</div><div className={`text-2xl font-bold mt-1 ${tone ?? ""}`}>{value}</div></div>
  );
  return (
    <>
      <h1 className="h1">Overview</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat("Agencies", o.tenants)}
        {stat("Paying", o.active)}
        {stat("On trial", o.trialing)}
        {stat("Lapsed or cancelled", o.lapsed, o.lapsed > 0 ? "text-[var(--warn)]" : "")}
        {stat("Monthly recurring revenue", formatMoney(o.mrr_minor))}
        {stat("Collected, last 30 days", formatMoney(o.collected_30d_minor))}
        {stat("New agencies, last 30 days", o.signups_30d)}
        {stat("Suspended", o.suspended)}
        {stat("Candidates held", Number(o.candidates).toLocaleString("en-KE"))}
        {stat("Placements", Number(o.placements).toLocaleString("en-KE"))}
      </div>
      <p className="muted text-xs">Revenue counts agencies whose current plan period is paid. Trials are not counted.</p>
    </>
  );
}
