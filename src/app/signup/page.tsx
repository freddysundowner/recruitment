import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { signupEnabled } from "@/lib/plan";
import { getCtx } from "@/lib/session";
import { SignupForm } from "./form";

export default async function SignupPage() {
  if (await getCtx()) redirect("/");
  if (!signupEnabled()) return <main className="min-h-screen grid place-items-center p-4"><div className="card max-w-md"><h1 className="h1">Sign-up is closed</h1><p className="muted mt-1">Contact us to open an account. Already have one? <Link className="link" href="/login">Sign in</Link>.</p></div></main>;
  const points = [
    "Candidates, documents and employers in one place",
    "Nine clear stages from registration to follow-up",
    "M-Pesa collections and a page candidates can use from their phones",
  ];
  return (
    <main className="min-h-screen grid place-items-center p-4" style={{ background: "linear-gradient(180deg, #eef3f2 0%, var(--bg) 60%)" }}>
      <div className="card w-full max-w-4xl grid md:grid-cols-5 overflow-hidden" style={{ padding: 0 }}>
        <aside className="md:col-span-2 p-8 text-white hidden md:flex flex-col justify-between gap-8" style={{ background: "linear-gradient(160deg, var(--brand), color-mix(in srgb, var(--brand) 70%, black))" }}>
          <div>
            <div className="text-xs font-semibold tracking-wide uppercase opacity-80">Recruitment workspace</div>
            <h2 className="mt-3" style={{ fontSize: 26, lineHeight: 1.2, fontWeight: 800 }}>Everything your agency does, in one tidy place.</h2>
          </div>
          <ul className="grid gap-3">
            {points.map((p) => <li key={p} className="flex items-start gap-2.5"><CheckCircle2 size={18} className="mt-0.5 flex-none" /><span>{p}</span></li>)}
          </ul>
        </aside>
        <div className="md:col-span-3 grid gap-4 content-start" style={{ padding: 32 }}>
          <div>
            <h1 className="h1">Create your workspace</h1>
            <p className="muted">It takes a minute. Your data stays private to your agency.</p>
          </div>
          <SignupForm />
          <p className="muted text-sm">Already have an account? <Link className="link" href="/login">Sign in</Link></p>
        </div>
      </div>
    </main>
  );
}
