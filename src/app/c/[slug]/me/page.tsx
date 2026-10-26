import { withCandidate } from "@/lib/db";
import { requireCandidate } from "@/lib/portal-session";
import { ActionForm } from "@/components/ActionForm";
import { portalProfile } from "@/app/actions/portal";

export default async function Me({ params }: PageProps<"/c/[slug]/me">) {
  const { slug } = await params;
  const { agency, me } = await requireCandidate(slug);
  const [c] = await withCandidate(agency.id, me.candidateId, (tx) => tx`SELECT * FROM candidates WHERE id = ${me.candidateId}`);
  return (
    <>
      <h1 className="h1">My profile</h1>
      <div className="card grid gap-3">
        <div><div className="label">Name</div>{c.first_name} {c.last_name}</div>
        <div><div className="label">Phone (used to sign in)</div>{c.phone}</div>
        <p className="muted text-xs">To change your name, ID number or phone number, please contact the agency so we can check it.</p>
        <ActionForm action={portalProfile.bind(null, slug)} submit="Save" resetOnSuccess={false}>
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" defaultValue={c.email ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="county">County</label><input id="county" name="county" defaultValue={c.county ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="skills">Skills</label><textarea id="skills" name="skills" rows={2} defaultValue={c.skills} className="textarea" /></div>
          <div><label className="label" htmlFor="experience">Work experience</label><textarea id="experience" name="experience" rows={3} defaultValue={c.experience} className="textarea" /></div>
          <div><label className="label" htmlFor="preferred_countries">Where would you like to work?</label><input id="preferred_countries" name="preferred_countries" defaultValue={c.preferred_countries} className="input" /></div>
        </ActionForm>
      </div>
    </>
  );
}
