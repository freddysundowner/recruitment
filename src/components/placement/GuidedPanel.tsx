import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { GateItem } from "@/lib/pipeline";
import type { Guide } from "@/lib/guide";
import { ActionForm } from "@/components/ActionForm";
import { assignJobOrder, moveStageAction, reopenCandidate, setRequirement } from "@/app/actions/placements";

type Job = { id: string; title: string; company: string; country: string; quantity: number; filled: number; vetted: boolean };

/**
 * The one thing a recruiter needs on a candidate's page: where they are, what is still missing before the next
 * stage, and a single button once nothing is missing. The list comes from the same rules that gate the move.
 */
export function GuidedPanel({ candidateId, guide, canMove, jobs }: {
  candidateId: string;
  guide: Guide | null;
  canMove: boolean;
  jobs: Job[];
}) {
  if (!guide) {
    return (
      <div className="card guide">
        <div className="eyebrow mb-1">Do this now</div>
        <div className="h2">Not in the pipeline</div>
        <p className="muted mt-1">Put them back at the first stage to start again.</p>
        {canMove && <ActionForm action={reopenCandidate.bind(null, candidateId)} confirm="Put this candidate back into the pipeline at the first stage?" submit="Re-enter pipeline" className="mt-3" buttonClass="btn btn-primary"><></></ActionForm>}
      </div>
    );
  }
  const { placement, stages, cur, next, items } = guide;
  const placementId = placement.id;
  const left = items.filter((i) => !i.done);
  const ready = left.length === 0;
  const needsJobSoon = !placement.job_order_id && !items.some((i) => i.key === "job");

  const assign = (
    <ActionForm action={assignJobOrder.bind(null, placementId)} submit="Assign" className="flex flex-wrap items-end gap-2 mt-2" buttonClass="btn btn-sm btn-primary">
      <div className="min-w-56 flex-1">
        <label className="label sr-only" htmlFor="job_order_id">Opening</label>
        <select id="job_order_id" name="job_order_id" className="select" required defaultValue="">
          <option value="" disabled>Choose an opening…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id} disabled={j.filled >= j.quantity}>
              {j.title} · {j.company} ({j.filled}/{j.quantity})
            </option>
          ))}
        </select>
      </div>
    </ActionForm>
  );

  const row = (i: GateItem) => (
    <li key={i.key} className={`req ${i.done ? "done" : ""}`}>
      <span className="tick"><Check size={13} strokeWidth={3} /></span>
      <div className="flex-1 min-w-0">
        <div className="lbl font-semibold">{i.label}</div>
        {i.detail && <div className="muted text-xs">{i.detail}</div>}
        {i.key === "job" && !i.done && canMove && (jobs.length > 0 ? assign : <div className="muted text-xs mt-1">No openings yet. <Link className="link" href="/job-orders/new">Add one</Link></div>)}
      </div>
      {i.manual && canMove && (
        <ActionForm action={setRequirement.bind(null, placementId, i.manual.text, !i.done)} submit={i.done ? "Undo" : "Mark as met"} buttonClass="btn btn-sm" className="inline"><></></ActionForm>
      )}
      {!i.done && i.key !== "job" && !i.manual && (i.href || i.anchor) && (
        <Link className="btn btn-sm" href={i.href ?? i.anchor!}>Do this <ArrowRight size={14} /></Link>
      )}
    </li>
  );

  return (
    <div className="card guide">
      <div className="steps-strip mb-3" aria-label={`Stage ${cur.position} of ${stages.length}`}>
        {stages.map((s) => <i key={s.id} className={s.position < cur.position ? "done" : s.position === cur.position ? "now" : ""} title={s.name} />)}
      </div>
      <div className="eyebrow mb-1">Do this now · Stage {cur.position} of {stages.length}</div>
      <div className="h2">{cur.name}</div>
      <p className="muted">{cur.description}</p>

      {next ? (
        <div className="mt-3">
          <div className="font-semibold mb-1">{ready ? `Ready for ${next.name}` : `To move on to ${next.name}`}</div>
          {items.length > 0 && <ul>{items.map(row)}</ul>}
          {ready && items.length === 0 && <p className="muted">Nothing is holding them back.</p>}
          {needsJobSoon && canMove && jobs.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--line)]">
              <div className="font-semibold">Assign them to an opening <span className="muted font-normal">(needed before the company sees them)</span></div>
              {assign}
            </div>
          )}
          {canMove && (
            <ActionForm
              action={moveStageAction.bind(null, placementId)}
              confirm={`Move this recruit to ${next.name}? The recruit and the company may be messaged automatically.`}
              submit={`Move to ${next.name}`}
              className="mt-3"
              buttonClass="btn btn-primary btn-lg"
              disabled={!ready}
            >
              <input type="hidden" name="stage_id" value={next.id} />
              {!ready && <p className="muted text-xs">{left.length} thing{left.length === 1 ? "" : "s"} left. The button unlocks when they are done.</p>}
            </ActionForm>
          )}
        </div>
      ) : (
        <p className="mt-3">This is the last stage. Keep in touch with the worker, record each check-in, and close the case when the contract is complete.</p>
      )}
    </div>
  );
}
