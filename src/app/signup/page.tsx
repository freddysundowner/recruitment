import Link from "next/link";
import { redirect } from "next/navigation";
import { signupEnabled } from "@/lib/plan";
import { getCtx } from "@/lib/session";
import { SignupForm } from "./form";

export default async function SignupPage() {
  if (await getCtx()) redirect("/");
  if (!signupEnabled()) return <main className="min-h-screen grid place-items-center p-4"><div className="card max-w-md"><h1 className="h1">Sign-up is closed</h1><p className="muted mt-1">Contact us to open an account. Already have one? <Link className="link" href="/login">Sign in</Link>.</p></div></main>;
  return (
    <main className="min-h-screen grid place-items-center p-4" style={{ background: "linear-gradient(180deg, #eef3f2 0%, var(--bg) 60%)" }}>
      <div className="card w-full max-w-2xl grid gap-4" style={{ padding: 32 }}>
        <div>
          <h1 className="h1">Create your workspace</h1>
          <p className="muted">It takes a minute. Your data stays private to your agency.</p>
        </div>
        <SignupForm />
        <p className="muted text-sm">Already have an account? <Link className="link" href="/login">Sign in</Link></p>
      </div>
    </main>
  );
}
