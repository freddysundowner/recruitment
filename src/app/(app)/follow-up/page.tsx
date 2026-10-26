import Link from "next/link";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";

const fmt = (d: unknown) => new Date(d as string).toLocaleDateString("en-KE");

export default async function FollowUp() {
  const ctx = await requireCtx();
  const d = await withTenant(ctx.tenantId, async (tx) => ({
    checkins: await tx`
      SELECT k.*, (current_date - k.due_on) AS late, c.first_name, c.last_name, j.title, e.company, e.country
      FROM checkins k JOIN placements p ON p.id = k.placement_id JOIN candidates c ON c.id = p.candidate_id
      LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
      WHERE k.done_on IS NULL AND p.outcome <> 'closed' ORDER BY k.due_on LIMIT 100`,
    concerns: await tx`
      SELECT k.*, c.first_name, c.last_name FROM checkins k JOIN placements p ON p.id = k.placement_id JOIN candidates c ON c.id = p.candidate_id
      WHERE k.outcome IN ('concern', 'unreachable') ORDER BY k.done_on DESC LIMIT 20`,
    appts: await tx`
      SELECT a.*, p.id AS pid, c.first_name, c.last_name FROM appointments a JOIN placements p ON p.id = a.placement_id JOIN candidates c ON c.id = p.candidate_id
      WHERE a.result = 'pending' AND a.scheduled_at >= now() - interval '1 day' ORDER BY a.scheduled_at LIMIT 30`,
    departures: await tx`
      SELECT t.*, c.first_name, c.last_name FROM placement_travel t JOIN placements p ON p.id = t.placement_id JOIN candidates c ON c.id = p.candidate_id
      WHERE t.departure_on >= current_date AND t.arrival_confirmed_on IS NULL ORDER BY t.departure_on LIMIT 30`,
  }));
  return (
    <div className="grid gap-4">
      <h1 className="h1">Follow-up</h1>
      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Workers to check on</div>
        <table className="table mt-2">
          <thead><tr><th>Due</th><th>Worker</th><th>Employer</th></tr></thead>
          <tbody>
            {d.checkins.map((k) => (
              <tr key={k.id}>
                <td>{fmt(k.due_on)}{Number(k.late) > 0 && <span className="badge badge-bad ml-2">{k.late}d overdue</span>}</td>
                <td><Link className="link" href={`/placements/${k.placement_id}`}>{k.first_name} {k.last_name}</Link></td>
                <td>{k.company ? `${k.title}, ${k.company} (${k.country})` : "—"}</td>
              </tr>
            ))}
            {d.checkins.length === 0 && <tr><td colSpan={3} className="muted">Nothing due.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="h2 mb-2">Upcoming appointments</div>
          <table className="table"><tbody>
            {d.appts.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{new Date(a.scheduled_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td><Link className="link" href={`/placements/${a.pid}`}>{a.first_name} {a.last_name}</Link><div className="muted text-xs">{a.kind} {a.location && `· ${a.location}`}</div></td>
              </tr>
            ))}
            {d.appts.length === 0 && <tr><td className="muted">None booked.</td></tr>}
          </tbody></table>
        </div>
        <div className="card">
          <div className="h2 mb-2">Departures not yet confirmed</div>
          <table className="table"><tbody>
            {d.departures.map((t) => (
              <tr key={t.placement_id}>
                <td className="whitespace-nowrap">{fmt(t.departure_on)}</td>
                <td><Link className="link" href={`/placements/${t.placement_id}`}>{t.first_name} {t.last_name}</Link><div className="muted text-xs">{t.airline} {t.flight_no}</div></td>
              </tr>
            ))}
            {d.departures.length === 0 && <tr><td className="muted">None.</td></tr>}
          </tbody></table>
        </div>
      </div>
      {d.concerns.length > 0 && (
        <div className="card">
          <div className="h2 mb-2">Recent concerns from check-ins</div>
          <table className="table"><tbody>
            {d.concerns.map((k) => (
              <tr key={k.id}>
                <td>{fmt(k.done_on)}</td>
                <td><Link className="link" href={`/placements/${k.placement_id}`}>{k.first_name} {k.last_name}</Link></td>
                <td><span className="badge badge-bad">{k.outcome}</span></td><td className="muted">{k.notes}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
