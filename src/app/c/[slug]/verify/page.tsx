import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgency } from "@/lib/portal-session";
import { ActionForm } from "@/components/ActionForm";
import { verifyCode } from "@/app/actions/portal";

export default async function Verify({ params }: PageProps<"/c/[slug]/verify">) {
  const { slug } = await params;
  await requireAgency(slug);
  const jar = await cookies();
  let saved: { slug: string; phone: string; mode: string } | null = null;
  try { saved = JSON.parse(jar.get("cphone")?.value ?? "null"); } catch { saved = null; }
  if (!saved || saved.slug !== slug) redirect(`/c/${slug}/login`);
  const dev = jar.get("cdev")?.value;
  const masked = saved.phone.replace(/^(\+\d{3})\d+(\d{3})$/, "$1•••••$2");
  return (
    <div className="card grid gap-3">
      <h1 className="h1">Enter your code</h1>
      <p className="muted">If {masked} is {saved.mode === "login" ? "registered with us" : "a valid number"}, a 6-digit code was sent by SMS. It works for 10 minutes.</p>
      {dev && <div className="badge badge-warn w-fit">Test mode: your code is {dev}</div>}
      <ActionForm action={verifyCode.bind(null, slug)} submit={saved.mode === "login" ? "Sign in" : "Finish registering"} resetOnSuccess={false}>
        <div><label className="label" htmlFor="code">6-digit code</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="input !py-3 text-2xl tracking-widest" /></div>
      </ActionForm>
    </div>
  );
}
