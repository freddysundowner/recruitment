import Link from "next/link";
import { requireAgency } from "@/lib/portal-session";
import { ActionForm } from "@/components/ActionForm";
import { requestRegisterCode } from "@/app/actions/portal";

export default async function Register({ params }: PageProps<"/c/[slug]/register">) {
  const { slug } = await params;
  const agency = await requireAgency(slug);
  if (!agency.portal_open) return <div className="alert">Online registration is closed at the moment. Please visit the agency.</div>;
  return (
    <div className="card grid gap-3">
      <h1 className="h1">Register</h1>
      <p className="muted">Tell us about yourself. We will send a code to your phone to confirm it is yours.</p>
      <ActionForm action={requestRegisterCode.bind(null, slug)} submit="Send me a code" resetOnSuccess={false}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label" htmlFor="first_name">First name</label><input id="first_name" name="first_name" required className="input" /></div>
          <div><label className="label" htmlFor="last_name">Last name</label><input id="last_name" name="last_name" required className="input" /></div>
          <div><label className="label" htmlFor="phone">Phone number</label><input id="phone" name="phone" type="tel" inputMode="tel" placeholder="0712 345 678" required className="input" /></div>
          <div><label className="label" htmlFor="id_number">National ID number</label><input id="id_number" name="id_number" className="input" /></div>
          <div><label className="label" htmlFor="county">County</label><input id="county" name="county" className="input" /></div>
        </div>
        <div><label className="label" htmlFor="skills">What work can you do?</label><textarea id="skills" name="skills" rows={2} className="textarea" placeholder="For example: cleaning, cooking, driving, nursing" /></div>
        <label className="flex items-start gap-2"><input type="checkbox" name="consent" className="mt-1" /><span>I agree that this agency may keep my details and contact me about jobs.</span></label>
      </ActionForm>
      <Link className="link" href={`/c/${slug}/login`}>Already registered? Sign in</Link>
    </div>
  );
}
