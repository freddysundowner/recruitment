import { notFound } from "next/navigation";
import { withEmployer } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { decrypt, mask } from "@/lib/crypto";
import { formatMoney, CURRENCIES } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { employerContract, employerInterview, employerReject, employerSelect } from "@/app/actions/employer";

const age = (dob: unknown) => (dob ? Math.floor((Date.now() - new Date(dob as string).getTime()) / 31_557_600_000) : null);

export default async function EmployerJob({ params }: PageProps<"/employer/jobs/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withEmployer(ctx.tenantId, ctx.employerId!, async (tx) => {
    const [j] = await tx`SELECT * FROM job_orders WHERE id = ${id}`;
    if (!j) return null;
    const people = await tx`
      SELECT p.id, p.outcome, p.close_reason, s.position, s.name AS stage,
             c.first_name, c.last_name, c.gender, c.dob, c.county, c.skills, c.experience, c.id_number_enc
      FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id JOIN candidates c ON c.id = p.candidate_id
      WHERE p.job_order_id = ${id} AND s.position >= 2 ORDER BY (p.outcome = 'closed'), s.position, c.first_name`;
    const appts = await tx`SELECT placement_id, scheduled_at, location, result FROM appointments WHERE kind = 'interview' ORDER BY scheduled_at`;
    const contracts = await tx`SELECT DISTINCT ON (placement_id, party) placement_id, party, salary_minor, currency, hours_per_week, months FROM contracts ORDER BY placement_id, party, created_at DESC`;
    const travel = await tx`SELECT placement_id, departure_on, arrival_confirmed_on, employer_start_on FROM placement_travel`;
    return { j, people, appts, contracts, travel };
  });
  if (!d) notFound();
  const { j } = d;

  return (
    <>
      <div>
        <h1 className="h1">{j.title}</h1>
        <div className="muted">{j.country} · {j.quantity} worker{j.quantity > 1 ? "s" : ""}{j.salary ? ` · ${j.salary}` : ""}</div>
      </div>
      {j.status === "pending" && <div className="alert">Your request is waiting for the agency to approve it.</div>}

      {d.people.map((p) => {
        const mine = d.appts.filter((a) => a.placement_id === p.id);
        const employerCopy = d.contracts.find((c) => c.placement_id === p.id && c.party === "employer");
        const tr = d.travel.find((t) => t.placement_id === p.id);
        const deciding = p.outcome !== "closed" && p.position === 2;
        return (
          <div key={p.id} className="card grid gap-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="h2">{p.first_name} {p.last_name}</div>
                <div className="muted text-sm">{[p.gender, age(p.dob) ? `${age(p.dob)} years` : null, p.county].filter(Boolean).join(" · ")}{p.id_number_enc ? ` · ID ${mask(decrypt(p.id_number_enc))}` : ""}</div>
              </div>
              <span className={`badge ${p.outcome === "closed" ? "badge-bad" : deciding ? "badge-warn" : "badge-good"}`}>{p.outcome === "closed" ? p.close_reason : deciding ? "Waiting for your decision" : p.stage}</span>
            </div>
            {p.skills && <div><div className="label">Skills</div>{p.skills}</div>}
            {p.experience && <div><div className="label">Experience</div><p className="whitespace-pre-wrap">{p.experience}</p></div>}
            {mine.length > 0 && <div><div className="label">Interviews</div>{mine.map((a, i) => <div key={i}>{new Date(a.scheduled_at).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {a.location} · <b>{a.result}</b></div>)}</div>}

            {deciding && (
              <div className="grid lg:grid-cols-3 gap-4 pt-3 border-t border-[var(--line)]">
                <ActionForm confirm="Request an interview with this candidate? The candidate is told." action={employerInterview.bind(null, p.id)} submit="Request interview" buttonClass="btn" className="grid gap-2">
                  <div className="h2">Interview</div>
                  <input name="scheduled_at" type="datetime-local" required className="input" aria-label="Interview date and time" />
                  <input name="location" placeholder="Place or video link" className="input" />
                </ActionForm>
                <ActionForm action={employerSelect.bind(null, p.id)} submit="Select this candidate" className="grid gap-2" confirm="Select this candidate? The agency will prepare the contract.">
                  <div className="h2">Select</div>
                  <input name="notes" placeholder="Note for the agency (optional)" className="input" />
                </ActionForm>
                <ActionForm confirm="Decline this candidate? The agency is told." action={employerReject.bind(null, p.id)} submit="Decline" buttonClass="btn btn-danger" className="grid gap-2">
                  <div className="h2">Decline</div>
                  <input name="notes" placeholder="Reason (required)" required className="input" />
                </ActionForm>
              </div>
            )}

            {p.outcome !== "closed" && p.position >= 5 && (
              <div id="contracts" style={{ scrollMarginTop: 80 }} className="pt-3 border-t border-[var(--line)] grid gap-2">
                <div className="h2">Your contract terms</div>
                {employerCopy ? (
                  <div className="badge badge-good w-fit">Recorded: {formatMoney(employerCopy.salary_minor, employerCopy.currency)} / month · {employerCopy.hours_per_week ?? "?"} h/week · {employerCopy.months ?? "?"} months</div>
                ) : <p className="muted text-sm">Enter the terms in the contract you signed. The agency checks them against the worker&apos;s copy before travel.</p>}
                <ActionForm action={employerContract.bind(null, p.id)} submit={employerCopy ? "Record corrected terms" : "Record contract terms"} buttonClass="btn" className="grid gap-2" resetOnSuccess={false}>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <input name="salary" placeholder="Monthly salary" required className="input" aria-label="Monthly salary" />
                    <select name="currency" className="select" defaultValue={j.fee_currency} aria-label="Currency">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                    <input name="hours" type="number" placeholder="Hours/week" className="input" aria-label="Hours per week" />
                    <input name="months" type="number" placeholder="Months" className="input" aria-label="Contract length in months" />
                    <input name="other_terms" placeholder="Other terms" className="input" aria-label="Other terms" />
                  </div>
                </ActionForm>
              </div>
            )}
            {tr?.departure_on && <div className="muted text-sm">Departure {new Date(tr.departure_on).toLocaleDateString("en-KE")}{tr.arrival_confirmed_on ? ` · arrived ${new Date(tr.arrival_confirmed_on).toLocaleDateString("en-KE")}` : ""}</div>}
          </div>
        );
      })}
      {d.people.length === 0 && j.status !== "pending" && <div className="card muted">No candidates have been shortlisted yet. You will get an email when there are some.</div>}
    </>
  );
}
