import { withTenant } from "@/lib/db";
import { contractStatus, requiredDocs } from "@/lib/pipeline";
import { formatMoney, CURRENCIES } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
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

export async function Operations({ placementId, tenantId, canEdit, stageRequiredDocs, candidateId }: {
  placementId: string; tenantId: string; canEdit: boolean; stageRequiredDocs: string[]; candidateId: string;
}) {
  const d = await withTenant(tenantId, async (tx) => {
    const [pl] = await tx`SELECT j.country, j.category FROM placements p LEFT JOIN job_orders j ON j.id = p.job_order_id WHERE p.id = ${placementId}`;
    const [checklist] = pl?.country
      ? await tx`
          SELECT * FROM country_checklists WHERE lower(country) = lower(${pl.country}) AND (lower(job_category) = lower(${pl.category ?? ""}) OR job_category = '')
          ORDER BY (job_category <> '') DESC LIMIT 1`
      : [];
    const required = await requiredDocs(tx, placementId, stageRequiredDocs);
    return {
      country: pl?.country as string | null,
      checklist,
      required,
      docs: await tx`SELECT doc_type, status, expiry_date FROM documents WHERE candidate_id = ${candidateId}`,
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

  const docStatus = (type: string) => {
    const mine = d.docs.filter((x) => x.doc_type === type);
    if (mine.some((x) => x.status === "verified" && (!x.expiry_date || iso(x.expiry_date) >= today))) return ["verified", "badge-good"];
    if (mine.some((x) => x.status === "pending")) return ["awaiting verification", "badge-warn"];
    if (mine.some((x) => x.status === "verified")) return ["expired", "badge-bad"];
    return ["missing", "badge-bad"];
  };

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
      {(d.required.length > 0 || d.checklist) && (
        <div id="checklist" style={{ scrollMarginTop: 80 }} className="card">
          <div className="h2 mb-1">Checklist for {d.country ?? "destination"}</div>
          {!d.checklist && <p className="muted text-xs mb-2">Using the stage defaults. Add a checklist for this country in Settings to customise it.</p>}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="label">Documents</div>
              <ul className="grid gap-1">
                {d.required.map((r) => {
                  const [label, cls] = docStatus(r);
                  return <li key={r} className="flex items-center justify-between gap-2"><span>{r}</span><span className={`badge ${cls}`}>{label}</span></li>;
                })}
              </ul>
            </div>
            {d.checklist && (d.checklist.steps as string[]).length > 0 && (
              <div>
                <div className="label">Steps</div>
                <ul className="grid gap-1">
                  {(d.checklist.steps as string[]).map((s) => (
                    <li key={s} className="flex items-center justify-between gap-2">
                      <span className={stepsDone.has(s) ? "line-through muted" : ""}>{s}</span>
                      {canEdit && (
                        <ActionForm action={toggleStep.bind(null, placementId, s, !stepsDone.has(s))} submit={stepsDone.has(s) ? "Undo" : "Done"} buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div id="contract" style={{ scrollMarginTop: 80 }} className="card">
        <div className="h2 mb-2">Contract</div>
        {contract.differences.length > 0 && (
          <div className="alert mb-3">The candidate&apos;s copy and the employer&apos;s copy differ on: {contract.differences.join(", ")}. This can mean the terms were changed. Do not proceed until it is explained.</div>
        )}
        {contract.candidate && contract.employer && contract.differences.length === 0 && <div className="badge badge-good mb-3">Both copies agree</div>}
        {canEdit ? (
          <div className="grid lg:grid-cols-2 gap-6">{contractForm("candidate")}{contractForm("employer")}</div>
        ) : (
          <p className="muted">{d.contracts.length} contract record(s).</p>
        )}
      </div>

      <div id="travel" style={{ scrollMarginTop: 80 }} className="card">
        <div className="h2 mb-2">Visa and travel</div>
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
      </div>

      <div id="appointments" style={{ scrollMarginTop: 80 }} className="card">
        <div className="h2 mb-2">Appointments</div>
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
                        <ActionForm key={r} action={setAppointmentResult.bind(null, a.id, placementId, r)} submit={r.replace("_", " ")} buttonClass="btn btn-sm" className="inline"><></></ActionForm>
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
      </div>

      {d.checkins.length > 0 && (
        <div className="card">
          <div className="h2 mb-2">Follow-up check-ins</div>
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
        </div>
      )}
    </>
  );
}
