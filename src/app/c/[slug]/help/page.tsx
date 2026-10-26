import { withCandidate } from "@/lib/db";
import { requireCandidate } from "@/lib/portal-session";
import { ActionForm } from "@/components/ActionForm";
import { portalComplaint, requestData } from "@/app/actions/portal";

export default async function Help({ params }: PageProps<"/c/[slug]/help">) {
  const { slug } = await params;
  const { agency, me } = await requireCandidate(slug);
  const d = await withCandidate(agency.id, me.candidateId, async (tx) => ({
    complaints: await tx`SELECT subject, body, status, resolution, created_at FROM complaints ORDER BY created_at DESC`,
    reqs: await tx`SELECT kind, status FROM data_requests ORDER BY created_at DESC LIMIT 4`,
  }));
  return (
    <>
      <h1 className="h1">Help and complaints</h1>
      <div className="card">
        <div className="h2 mb-1">Tell us about a problem</div>
        <p className="muted text-sm mb-2">If you were asked for money without a receipt, if the job is not what was promised, or if you are being treated badly, tell us here. We read every message.</p>
        <ActionForm action={portalComplaint.bind(null, slug)} submit="Send complaint">
          <div><label className="label" htmlFor="subject">What is it about?</label><input id="subject" name="subject" required className="input !py-3" /></div>
          <div><label className="label" htmlFor="body">What happened?</label><textarea id="body" name="body" rows={4} required className="textarea" /></div>
        </ActionForm>
      </div>
      {d.complaints.length > 0 && (
        <div className="card">
          <div className="h2 mb-2">Your complaints</div>
          {d.complaints.map((c, i) => (
            <div key={i} className="border-b border-[var(--line)] py-2 last:border-0">
              <div className="flex justify-between gap-2"><b>{c.subject}</b><span className={`badge ${c.status === "resolved" ? "badge-good" : "badge-warn"}`}>{c.status}</span></div>
              <div className="muted text-xs">{new Date(c.created_at).toLocaleDateString("en-KE")}</div>
              {c.resolution && <p className="mt-1"><b>Answer:</b> {c.resolution}</p>}
            </div>
          ))}
        </div>
      )}
      <div className="card grid gap-2">
        <div className="h2">Your information</div>
        <p className="muted text-sm">You can ask for a copy of everything the agency holds about you, or ask the agency to delete your details once you no longer need its services.</p>
        <a className="btn w-fit" href={`/c/${slug}/export`}>Download my information</a>
        <ActionForm action={requestData.bind(null, slug, "delete")} submit="Ask the agency to delete my information" buttonClass="btn btn-danger" className="" confirm="Ask the agency to delete your information? You will lose your application."><></></ActionForm>
        {d.reqs.map((r, i) => <div key={i} className="muted text-xs">Request to {r.kind} your data: {r.status}</div>)}
      </div>
    </>
  );
}
