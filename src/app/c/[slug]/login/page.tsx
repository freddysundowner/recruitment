import Link from "next/link";
import { requireAgency } from "@/lib/portal-session";
import { ActionForm } from "@/components/ActionForm";
import { requestLoginCode } from "@/app/actions/portal";

export default async function Login({ params }: PageProps<"/c/[slug]/login">) {
  const { slug } = await params;
  await requireAgency(slug);
  return (
    <div className="card grid gap-3">
      <h1 className="h1">Sign in</h1>
      <p className="muted">We will send a 6-digit code by SMS to the phone number you registered with.</p>
      <ActionForm action={requestLoginCode.bind(null, slug)} submit="Send me a code" resetOnSuccess={false}>
        <div><label className="label" htmlFor="phone">Phone number</label><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" required className="input !py-3 text-lg" /></div>
      </ActionForm>
      <Link className="link" href={`/c/${slug}/register`}>New here? Register</Link>
    </div>
  );
}
