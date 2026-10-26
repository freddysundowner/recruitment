import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { signupEnabled, trialDays } from "@/lib/plan";
import { getCtx } from "@/lib/session";
import { SignupForm } from "./form";

export default async function SignupPage() {
  if (await getCtx()) redirect("/");
  if (!signupEnabled()) return <main className="min-h-screen grid place-items-center p-4"><div className="card max-w-md"><h1 className="h1">Sign-up is closed</h1><p className="muted mt-1">Contact us to open an account. Already have one? <Link className="link" href="/login">Sign in</Link>.</p></div></main>;
  const plans = await sql`SELECT code, name, price_kes_minor, max_users, max_candidates FROM plans WHERE active ORDER BY sort`;
  return (
    <main className="min-h-screen grid place-items-center p-4" style={{ background: "linear-gradient(180deg, #eef3f2 0%, var(--bg) 60%)" }}>
      <div className="card w-full max-w-xl grid gap-3" style={{ padding: 26 }}>
        <div>
          <h1 className="h1">Start your agency&apos;s free trial</h1>
          <p className="muted">{trialDays()} days free. No card needed. Your data stays private to your agency.</p>
        </div>
        <SignupForm plans={plans.map((p) => ({ code: p.code, label: `${p.name}: ${formatMoney(p.price_kes_minor)} / month, ${p.max_users ?? "unlimited"} staff, ${p.max_candidates ? Number(p.max_candidates).toLocaleString("en-KE") : "unlimited"} candidates` }))} />
        <p className="muted text-xs">Already have an account? <Link className="link" href="/login">Sign in</Link></p>
      </div>
    </main>
  );
}
