import Link from "next/link";
import { redirect } from "next/navigation";
import { getCandidateCtx, requireAgency } from "@/lib/portal-session";

export default async function Landing({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const agency = await requireAgency(slug);
  if (await getCandidateCtx(agency.id)) redirect(`/c/${slug}/home`);
  const name = agency.brand_name || agency.name;
  return (
    <div className="card grid gap-4">
      <div>
        <h1 className="h1">Find work abroad with {name}</h1>
        <p className="muted mt-1">Register, send your documents, apply for jobs and follow your application from your phone.</p>
      </div>
      {agency.portal_open ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href={`/c/${slug}/login`} className="btn btn-primary !py-3">Sign in with my phone</Link>
          <Link href={`/c/${slug}/register`} className="btn !py-3">Register as a new candidate</Link>
        </div>
      ) : (
        <div className="alert">The candidate portal is closed at the moment. Please visit the agency.</div>
      )}
      <p className="muted text-xs">Agency staff sign in <Link className="link" href="/login">here</Link>.</p>
    </div>
  );
}
