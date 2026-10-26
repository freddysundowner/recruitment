import { withTenant } from "@/lib/db";
import { contractStatus } from "@/lib/pipeline";
import { formatMoney, CURRENCIES } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { Section } from "@/components/ui/Section";
import {
  addAppointment, addContract, completeCheckin, saveTravel, setAppointmentResult, toggleStep,
} from "@/app/actions/operations";

const iso = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");
const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");
const fmtDT = (d: unknown) => new Date(d as string).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const date = (name: string, label: string, v?: unknown) => (
  <div><label className="label" htmlFor={`t_${name}`}>{label}</label><input id={`t_${name}`} name={name} type="date" defaultValue={iso(v)} className="input" /></div>
);
const text = (name: string, label: string, v?: unknown) => (
  <div><label className="label" htmlFor={`t_${name}`}>{label}</label><input id={`t_${name}`} name={name} defaultValue={(v as string) ?? ""} className="input" /></div>
);

export async function Operations({ placementId, tenantId, canEdit, pos, focus }: {
  placementId: string; tenantId: string; canEdit: boolean;
  /** The stage the placement is at, and which anchors the guide says still need attention. */
  pos: number; focus: string[];
}) {
  const d = await withTenant(tenantId, async (tx) => {
    const [pl] = await tx`SELECT j.country, j.category FROM placements p LEFT JOIN job_orders j ON j.id = p.job_order_id WHERE p.id = ${placementId}`;
    const [checklist] = pl?.country
      ? await tx`
          SELECT * FROM country_checklists WHERE lower(country) = lower(${pl.country}) AND (lower(job_category) = lower(${pl.category ?? ""}) OR job_category = '')
          ORDER BY (job_category <> '') DESC LIMIT 1`
      : [];
    return {
      country: pl?.country as string | null,
      checklist,
      steps: await tx`SELECT step FROM placement_steps WHERE placement_id = ${placementId}`,
      travel: (await tx`SELECT * FROM placement_travel WHERE placement_id = ${placementId}`)[0],
      appts: await tx`SELECT * FROM appointments WHERE placement_id = ${placementId} ORDER BY scheduled_at DESC`,
      contracts: await tx`SELECT * FROM contracts WHERE placement_id = ${placementId} ORDER BY created_at DESC`,
      contract: await contractStatus(tx, placementId),
      checkins: await tx`SELECT * FROM checkins WHERE placement_id = ${placementId} ORDER BY due_on`,
    };
  });
  const { travel: t, contract } = d;
  const stepsDone = new Set(d.steps.map((s) => s.step as string));
  const today = new Date().toISOString().slice(0, 10);

  const contractForm = (party: "candidate" | "employer") => {
    const c = party === "candidate" ? contract.candidate : contract.employer;
    return (
      <ActionForm action={addContract.bind(null, placementId, party)} submit={`Record ${party}'s copy`} className="grid gap-3" resetOnSuccess={false}>
        <div className="h2">{party === "candidate" ? "Candidate's copy" : "Employer's signed copy"}</div>
        {c && <div className="muted text-xs">Latest: {formatMoney(c.salary_minor, c.currency)} / month · {c.hours_per_week ?? "?"} h/week · {c.months ?? "?"} months · signed {fmt(c.signed_on)}</div>}
        <div className="grid grid-cols-2 gap-3">
          {text("salary", "Monthly salary")}
          <div><label className="label" htmlFor={`c_cur_${party}`}>Currency</label><select id={`c_cur_${party}`} name="currency" className="select" defaultValue={c?.currency ?? "USD"}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><label className="label" htmlFor={`c_h_${party}`}>Hours per week</label><input id={`c_h_${party}`} name="hours" type="number" className="input" /></div>
          <div><label className="label" htmlFor={`c_m_${party}`}>Length (months)</label><input id={`c_m_${party}`} name="months" type="number" className="input" /></div>
          {date("signed_on", "Signed on")}
        </div>
        {text("other_terms", "Other terms")}
      </ActionForm>
    );
  };

  return (
    <>
      {d.checklist && (d.checklist.steps as string[]).length > 0 && (
        <Section id="checklist" title={`Checklist for ${d.country ?? "destination"}`} status={`${(d.checklist.steps as string[]).filter((x) => stepsDone.has(x)).length} of ${(d.checklist.steps as string[]).length} done`} open={focus.includes("#checklist")}>
          <ul className="grid gap-1">
            {(d.checklist.steps as string[]).map((st) => (
              <li key={st} className="flex items-center justify-between gap-2">
                <span className={stepsDone.has(st) ? "line-through muted" : ""}>{st}</span>
                {canEdit && (
                  <ActionForm action={toggleStep.bind(null, placementId, st, !stepsDone.has(st))} submit={stepsDone.has(st) ? "Undo" : "Done"} buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(pos >= 4 || d.contracts.length > 0 || focus.includes("#contract")) && (
      <Section id="contract" title="Contract"
        status={contract.differences.length ? "copies differ" : contract.candidate && contract.employer ? "both copies agree" : d.contracts.length ? "one copy recorded" : "not recorded"}
        tone={contract.differences.length ? "bad" : contract.candidate && contract.employer ? "good" : "warn"} open={focus.includes("#contract") || pos === 5}>
        {contract.differences.length > 0 && (
          <div className="alert mb-3">The candidate&apos;s copy and the employer&apos;s copy differ on: {contract.differences.join(", ")}. This can mean the terms were changed. Do not proceed until it is explained.</div>
        )}
        {contract.candidate && contract.employer && contract.differences.length === 0 && <div className="badge badge-good mb-3">Both copies agree</div>}
        {canEdit ? (
          <div className="grid lg:grid-cols-2 gap-6">{contractForm("candidate")}{contractForm("employer")}</div>
        ) : (
          <p className="muted">{d.contracts.length} contract record(s).</p>
        )}
      </Section>
      )}

      {(pos >= 6 || t || focus.includes("#travel")) && (
      <Section id="travel" title="Visa and travel" status={`visa ${(t?.visa_status ?? "not started").replace("_", " ")}`} tone={t?.visa_status === "approved" ? "good" : t?.visa_status === "refused" ? "bad" : undefined} open={focus.includes("#travel") || pos === 7}>
        {canEdit ? (
          <ActionForm action={saveTravel.bind(null, placementId)} submit="Save travel details" resetOnSuccess={false}>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="t_visa_status">Visa status</label>
                <select id="t_visa_status" name="visa_status" className="select" defaultValue={t?.visa_status ?? "not_started"}>
                  <option value="not_started">Not started</option><option value="applied">Applied</option><option value="approved">Approved</option><option value="refused">Refused</option>
                </select>
              </div>
              {date("visa_applied_on", "Applied on", t?.visa_applied_on)}
              {date("visa_decision_on", "Decision on", t?.visa_decision_on)}
              {text("visa_number", "Visa number", t?.visa_number)}
              {date("visa_expiry", "Visa expires", t?.visa_expiry)}
              {text("airline", "Airline", t?.airline)}
              {text("flight_no", "Flight number", t?.flight_no)}
              {text("ticket_ref", "Ticket reference", t?.ticket_ref)}
              {text("departure_airport", "Departure airport", t?.departure_airport)}
              {date("departure_on", "Departure date", t?.departure_on)}
              {date("orientation_done_on", "Orientation completed", t?.orientation_done_on)}
              {date("arrival_confirmed_on", "Arrival confirmed", t?.arrival_confirmed_on)}
              {date("employer_start_on", "Started work for employer", t?.employer_start_on)}
            </div>
            {text("notes", "Notes", t?.notes)}
          </ActionForm>
        ) : (
          <p className="muted">Visa: {t?.visa_status ?? "not started"}</p>
        )}
      </Section>
      )}

      <Section id="appointments" title="Appointments" status={d.appts.filter((a) => a.result === "pending").length ? `${d.appts.filter((a) => a.result === "pending").length} coming up` : d.appts.length ? `${d.appts.length} done` : "none yet"} open={focus.includes("#appointments") || pos === 3 || pos === 4}>
        <table className="table">
          <tbody>
            {d.appts.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{fmtDT(a.scheduled_at)}</td>
                <td>{a.kind}<div className="muted text-xs">{a.location}</div></td>
                <td><span className={`badge ${a.result === "passed" ? "badge-good" : a.result === "failed" || a.result === "no_show" ? "badge-bad" : ""}`}>{a.result}</span></td>
                <td className="text-right">
                  {canEdit && a.result === "pending" && (
                    <span className="inline-flex gap-1">
                      {["passed", "failed", "no_show", "cancelled"].map((r) => (
                        <ActionForm key={r} action={setAppointmentResult.bind(null, a.id, placementId, r)} confirm={r === "passed" ? undefined : `Record this appointment as ${r.replace("_", " ")}? The candidate may be told.`} submit={r.replace("_", " ")} buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {d.appts.length === 0 && <tr><td className="muted">No appointments.</td></tr>}
          </tbody>
        </table>
        {canEdit && (
          <ActionForm action={addAppointment.bind(null, placementId)} submit="Add appointment" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
            <div className="grid sm:grid-cols-4 gap-3">
              <div>
                <label className="label" htmlFor="a_kind">Type</label>
                <select id="a_kind" name="kind" className="select">{["interview", "medical", "embassy", "orientation", "other"].map((k) => <option key={k}>{k}</option>)}</select>
              </div>
              <div><label className="label" htmlFor="a_when">Date and time</label><input id="a_when" name="scheduled_at" type="datetime-local" required className="input" /></div>
              {text("location", "Place")}
              <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" name="notify" defaultChecked /> Tell the candidate</label>
            </div>
          </ActionForm>
        )}
      </Section>

      {d.checkins.length > 0 && (
        <Section id="followup" title="Follow-up check-ins" status={`${d.checkins.filter((c) => !c.done_on).length} to do`} tone={d.checkins.some((c) => !c.done_on && iso(c.due_on) < today) ? "bad" : undefined} open={pos >= 8}>
          <table className="table">
            <tbody>
              {d.checkins.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{fmt(c.due_on)}{!c.done_on && iso(c.due_on) < today && <span className="badge badge-bad ml-2">overdue</span>}</td>
                  <td>
                    {c.done_on ? (
                      <span><span className={`badge ${c.outcome === "well" ? "badge-good" : "badge-bad"}`}>{c.outcome}</span> <span className="muted">{c.notes}</span></span>
                    ) : canEdit ? (
                      <ActionForm action={completeCheckin.bind(null, c.id, placementId)} submit="Record" className="flex flex-wrap gap-2 items-end">
                        <select name="outcome" className="select !w-auto" defaultValue="well"><option value="well">Doing well</option><option value="concern">Concern</option><option value="unreachable">Unreachable</option></select>
                        <input name="notes" placeholder="Notes" className="input !w-64" />
                      </ActionForm>
                    ) : "Not done"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
