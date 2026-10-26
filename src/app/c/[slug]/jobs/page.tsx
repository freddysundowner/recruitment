import { withCandidate } from "@/lib/db";
import { requireCandidate } from "@/lib/portal-session";
import { ActionForm } from "@/components/ActionForm";
import { applyToJob, withdrawApplication } from "@/app/actions/portal";

export default async function Jobs({ params }: PageProps<"/c/[slug]/jobs">) {
  const { slug } = await params;
  const { agency, me } = await requireCandidate(slug);
  const { jobs, apps } = await withCandidate(agency.id, me.candidateId, async (tx) => ({
    jobs: await tx`SELECT id, title, country, category, salary, deadline, quantity FROM job_orders WHERE status = 'open' ORDER BY deadline NULLS LAST, created_at DESC`,
    apps: await tx`SELECT job_order_id, status FROM applications`,
  }));
  const mine = new Map(apps.map((a) => [a.job_order_id as string, a.status as string]));
  return (
    <>
      <h1 className="h1">Open jobs</h1>
      {jobs.map((j) => {
        const st = mine.get(j.id);
        return (
          <div key={j.id} className="card grid gap-2">
            <div>
              <div className="h2">{j.title}</div>
              <div className="muted">{j.country}{j.category ? ` · ${j.category}` : ""}</div>
            </div>
            <div className="text-sm">{j.salary && <span>Pay: <b>{j.salary}</b></span>}{j.deadline && <span className="ml-3">Apply by {new Date(j.deadline).toLocaleDateString("en-KE")}</span>}</div>
            {st && st !== "withdrawn" ? (
              <div className="flex items-center gap-3">
                <span className={`badge ${st === "shortlisted" ? "badge-good" : st === "declined" ? "badge-bad" : "badge-warn"}`}>{st === "pending" ? "Applied, waiting for the agency" : st}</span>
                {st === "pending" && <ActionForm confirm="Withdraw your application for this job?" action={withdrawApplication.bind(null, slug, j.id)} submit="Withdraw" buttonClass="btn btn-sm" className="inline"><></></ActionForm>}
              </div>
            ) : (
              <ActionForm confirm="Apply for this job? The agency will see your profile and documents." action={applyToJob.bind(null, slug, j.id)} submit="Apply for this job" className="" resetOnSuccess={false}><></></ActionForm>
            )}
          </div>
        );
      })}
      {jobs.length === 0 && <div className="card muted">There are no open jobs right now. Check again soon.</div>}
    </>
  );
}
