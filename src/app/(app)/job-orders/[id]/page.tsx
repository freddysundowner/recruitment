import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { ActionForm } from "@/components/ActionForm";
import { Section } from "@/components/ui/Section";
import { OpeningFields } from "@/components/OpeningFields";
import { approveJobOrder, setJobOrderStatus, updateJobOrder } from "@/app/actions/org";
import { assignJobOrder } from "@/app/actions/placements";
import { decideApplication } from "@/app/actions/operations";
import { fitItems, hasFitRequirements, placementDocItems, placementFit, type OpeningReqs, type RecruitFacts } from "@/lib/requirements";

const SUGGEST = 40;

export default async function Opening({ params }: PageProps<"/job-orders/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withTenant(ctx.tenantId, async (tx) => {
    const [j] = await tx`SELECT j.*, e.company, e.id AS employer_id FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.id = ${id}`;
    if (!j) return null;
    const placed = await tx`
      SELECT p.id, c.id AS cid, c.first_name, c.last_name, s.name AS stage
      FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN pipeline_stages s ON s.id = p.stage_id
      WHERE p.job_order_id = ${id} AND p.outcome <> 'closed' ORDER BY s.position DESC, c.first_name`;
    const people = [];
    for (const p of placed) {
      const items = [...(await placementFit(tx, p.id)), ...(await placementDocItems(tx, p.id))];
      people.push({ p, met: items.filter((i) => i.done).length, total: items.length });
    }
    const free = await tx`
      SELECT p.id AS pid, c.id AS cid, c.first_name, c.last_name, c.county, c.skills, c.dob, c.gender, c.experience_years
      FROM placements p JOIN candidates c ON c.id = p.candidate_id
      WHERE p.job_order_id IS NULL AND p.outcome = 'active' ORDER BY c.created_at DESC LIMIT ${SUGGEST}`;
    const applicants = await tx`
      SELECT a.id, c.id AS cid, c.first_name, c.last_name, c.county, c.skills,
             EXISTS (SELECT 1 FROM placements p WHERE p.candidate_id = c.id AND p.outcome <> 'closed' AND p.job_order_id IS NULL) AS free
      FROM applications a JOIN candidates c ON c.id = a.candidate_id WHERE a.job_order_id = ${id} AND a.status = 'pending' ORDER BY a.created_at`;
    return { j, people, free, applicants };
  });
  if (!d) notFound();
  const { j, people, free, applicants } = d;
  const reqs = j as unknown as OpeningReqs;
  const write = can(ctx.role, "joborders:write");
  const move = can(ctx.role, "pipeline:move");
  const full = people.length >= j.quantity;
  const canAssign = move && j.status === "open" && !full;

  const asked: string[] = [];
  if (j.min_age !== null || j.max_age !== null) asked.push(j.min_age !== null && j.max_age !== null ? `Age ${j.min_age} to ${j.max_age}` : j.min_age !== null ? `Age ${j.min_age} or over` : `Age ${j.max_age} or under`);
  if (j.gender) asked.push(`${j.gender} only`);
  if (j.min_experience_years !== null) asked.push(`At least ${j.min_experience_years} year${j.min_experience_years === 1 ? "" : "s"} of experience`);
  asked.push(...j.other_requirements);

  // Recruits not yet on an opening, best fit first. Hand-checked items cannot be judged here, so they are only counted.
  const options = free.map((c) => {
    const items = fitItems(reqs, c as unknown as RecruitFacts, []);
    const auto = items.filter((i) => !i.manual);
    return { c, missing: auto.filter((i) => !i.done), byHand: items.filter((i) => i.manual).length };
  }).sort((a, b) => a.missing.length - b.missing.length);

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="h1">{j.title}</h1>
          <div className="muted"><Link className="link" href={`/employers/${j.employer_id}`}>{j.company}</Link> · {j.country}{j.salary ? ` · ${j.salary}` : ""}</div>
        </div>
        {write && j.status !== "pending" && (
          <ActionForm
            action={setJobOrderStatus.bind(null, j.id, j.status === "open" ? "closed" : "open")}
            submit={j.status === "open" ? "Close opening" : "Reopen"}
            buttonClass="btn btn-sm"
            className=""
            confirm={j.status === "open" ? "Close this opening? Nobody more can be assigned to it." : undefined}
          ><></></ActionForm>
        )}
      </div>

      <div className="card grid sm:grid-cols-3 gap-3">
        <div><div className="label">Workers</div>{people.length} of {j.quantity}{full && <span className="badge badge-good ml-2">full</span>}</div>
        <div className="sm:col-span-2">
          <div className="label">A recruit must have</div>
          {j.required_doc_types.length > 0 || asked.length > 0 ? (
            <ul className="grid gap-0.5">
              {j.required_doc_types.length > 0 && <li>Documents checked: {j.required_doc_types.join(", ")}</li>}
              {asked.map((a: string) => <li key={a}>{a}</li>)}
            </ul>
          ) : <span className="muted">Nothing set. Anyone can be put forward.</span>}
        </div>
      </div>

      {write && (
        <Section id="edit" title="Change this opening" status="requirements">
          <ActionForm action={updateJobOrder.bind(null, j.id)} submit="Save changes" resetOnSuccess={false}>
            <OpeningFields v={j} />
          </ActionForm>
        </Section>
      )}

      {j.status === "pending" && write && (
        <div className="card grid gap-3">
          <div className="alert">The company asked for these workers. Check the details, then approve to open it.</div>
          <ActionForm confirm="Approve this opening?" action={approveJobOrder.bind(null, j.id)} submit="Approve and open" resetOnSuccess={false}>
            <input type="hidden" name="payment_model" value="employer_paid" />
            <></>
          </ActionForm>
        </div>
      )}

      {applicants.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <div className="p-4 pb-0 h2">Applied online ({applicants.length})</div>
          <table className="table">
            <tbody>
              {applicants.map((a) => (
                <tr key={a.id}>
                  <td><Link className="link" href={`/candidates/${a.cid}`}>{a.first_name} {a.last_name}</Link><div className="muted text-xs">{a.county} {a.skills && `· ${a.skills}`}</div></td>
                  <td className="text-right whitespace-nowrap">
                    {move && (
                      <span className="inline-flex gap-1">
                        {a.free && <ActionForm confirm="Assign this applicant to the opening? They are told." action={decideApplication.bind(null, a.id, "shortlisted", j.id)} submit="Assign" buttonClass="btn btn-sm btn-primary" className="inline"><></></ActionForm>}
                        <ActionForm confirm="Decline this application? They are told." action={decideApplication.bind(null, a.id, "declined", j.id)} submit="Decline" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                      </span>
                    )}
                    {!a.free && <span className="muted text-xs">already on another opening</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Recruits on this opening</div>
        <table className="table">
          <thead><tr><th>Recruit</th><th>Stage</th><th>Requirements met</th></tr></thead>
          <tbody>
            {people.map(({ p, met, total }) => (
              <tr key={p.id}>
                <td><Link className="link" href={`/candidates/${p.cid}`}>{p.first_name} {p.last_name}</Link></td>
                <td><span className="badge">{p.stage}</span></td>
                <td>{total === 0 ? <span className="muted">none asked</span> : <span className={`badge ${met === total ? "badge-good" : "badge-warn"}`}>{met} of {total}</span>}</td>
              </tr>
            ))}
            {people.length === 0 && <tr><td colSpan={3} className="muted">Nobody yet. Assign recruits from the list below.</td></tr>}
          </tbody>
        </table>
      </div>

      {j.status === "open" && (
        <div className="card p-0 overflow-x-auto">
          <div className="p-4 pb-0 h2">Recruits you can assign</div>
          <p className="muted text-xs px-4 pt-1">Recruits who are not on an opening yet. The ones who fit best are first.{hasFitRequirements(reqs) ? "" : " This opening has no requirements, so anyone fits."}</p>
          <table className="table">
            <tbody>
              {options.map(({ c, missing, byHand }) => (
                <tr key={c.pid}>
                  <td><Link className="link" href={`/candidates/${c.cid}`}>{c.first_name} {c.last_name}</Link><div className="muted text-xs">{[c.county, c.skills].filter(Boolean).join(" · ")}</div></td>
                  <td>
                    {missing.length === 0
                      ? <span className="badge badge-good">fits{byHand ? `, ${byHand} to check by hand` : ""}</span>
                      : <span className="text-xs">{missing.map((m) => `${m.label}${m.detail ? ` (${m.detail})` : ""}`).join("; ")}</span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {canAssign && (
                      <ActionForm action={assignJobOrder.bind(null, c.pid)} submit="Assign" buttonClass="btn btn-sm btn-primary" className="inline">
                        <input type="hidden" name="job_order_id" value={j.id} />
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
              {options.length === 0 && <tr><td className="muted">Every recruit is already on an opening. <Link className="link" href="/candidates/new">Add a recruit</Link></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
