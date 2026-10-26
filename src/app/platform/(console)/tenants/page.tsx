import Link from "next/link";
import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");

export default async function Tenants({ searchParams }: PageProps<"/platform/tenants">) {
  await requirePlatform();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.toLowerCase() : "";
  const rows = (await sql`SELECT *, (period_end < now()) AS expired FROM platform_tenants()`).filter((t) => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q));
  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="h1">Agencies</h1>
        <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Search name or address" className="input" /><button className="btn">Search</button></form>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Agency</th><th>Plan</th><th>Status</th><th>Paid until</th><th className="text-right">Staff</th><th className="text-right">Candidates</th><th>Last activity</th></tr></thead>
          <tbody>
            {rows.map((t) => {
              const expired = Boolean(t.expired);
              return (
                <tr key={t.id}>
                  <td><Link className="link" href={`/platform/tenants/${t.id}`}>{t.name}</Link><div className="muted text-xs">/c/{t.slug}</div></td>
                  <td>{t.plan_code}</td>
                  <td>
                    {t.status === "suspended" ? <span className="badge badge-bad">suspended</span> : expired ? <span className="badge badge-bad">lapsed</span> : <span className={`badge ${t.sub_status === "trialing" ? "badge-warn" : "badge-good"}`}>{t.sub_status}</span>}
                  </td>
                  <td>{fmt(t.period_end)}</td><td className="text-right">{Number(t.users_count)}</td><td className="text-right">{Number(t.candidates_count)}</td><td>{fmt(t.last_activity)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No agencies found.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
