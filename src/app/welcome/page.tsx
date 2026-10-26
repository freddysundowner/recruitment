import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, BadgeCheck, Building2, CalendarCheck, Check, FileCheck2, Globe2, KanbanSquare, MessageSquareText, ShieldCheck, Smartphone, Wallet,
} from "lucide-react";
import { sql } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { isSingleInstall, signupEnabled, trialDays } from "@/lib/plan";
import { getCtx } from "@/lib/session";

const FEATURES = [
  { Icon: KanbanSquare, t: "A pipeline that enforces your rules", d: "Nine stages from registration to follow-up abroad. A candidate cannot move on until documents are verified, fees are paid, the employer is vetted and the contract copies agree." },
  { Icon: FileCheck2, t: "Documents under control", d: "Passports, medicals and certificates with expiry alerts, a verification queue and a private, audited file store." },
  { Icon: Wallet, t: "Know your cash exposure", d: "See what you have paid out for employer-paid workers, what each employer owes, and your profit on every placement." },
  { Icon: Smartphone, t: "Candidates on their phones", d: "Candidates register, upload documents, apply, pay by M-Pesa and follow their progress, with no app to install." },
  { Icon: Building2, t: "Employers in the loop", d: "Employers review shortlists, request interviews, select, and record their signed terms so differences are caught before travel." },
  { Icon: MessageSquareText, t: "Messages that go out by themselves", d: "SMS, WhatsApp and email for stage changes, appointments, fee reminders and expiring documents." },
  { Icon: CalendarCheck, t: "Nobody forgotten after they fly", d: "Check-ins are scheduled automatically after deployment, and complaints have an owner until they are answered." },
  { Icon: ShieldCheck, t: "Built to protect your workers' data", d: "Each agency is walled off in the database, sensitive numbers are encrypted, and everything important is in an audit trail." },
];

export default async function Welcome() {
  if (isSingleInstall()) redirect("/login");
  if (await getCtx()) redirect("/");
  const plans = await sql`SELECT code, name, price_kes_minor, max_users, max_candidates, features FROM plans WHERE active ORDER BY sort`;
  const can = signupEnabled();
  const FEAT: [string, string][] = [["candidate_portal", "Candidate portal"], ["employer_portal", "Employer portal"], ["mpesa", "M-Pesa collection"], ["whatsapp", "WhatsApp messages"]];

  return (
    <div className="min-h-screen bg-white">
      <header className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5 font-bold text-[17px]"><span className="brand-mark"><Globe2 size={18} /></span> Recruitment Workspace</div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn btn-ghost">Sign in</Link>
          {can && <Link href="/signup" className="btn btn-primary">Start free trial</Link>}
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-5 pt-10 pb-14 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <span className="badge badge-brand mb-4"><BadgeCheck size={14} /> Made for overseas recruitment agencies</span>
          <h1 style={{ fontSize: 42, lineHeight: 1.1, letterSpacing: "-0.025em", fontWeight: 800 }}>Run your whole agency, from first registration to a worker settled abroad.</h1>
          <p className="muted mt-4 text-[17px]">Candidates, documents, employers, visas, contracts, M-Pesa and follow-up in one place. It tells you what to do next at every step, so nothing slips.</p>
          <div className="flex gap-3 mt-7 flex-wrap">
            {can ? <Link href="/signup" className="btn btn-primary btn-lg">Start your {trialDays()}-day free trial <ArrowRight size={17} /></Link> : <Link href="/login" className="btn btn-primary btn-lg">Sign in</Link>}
            <a href="#how" className="btn btn-lg">See how it works</a>
          </div>
          <p className="muted text-sm mt-3">No card needed. Try it with sample data, or bring your own, and remove the sample any time.</p>
        </div>
        <div className="card" style={{ padding: 22, background: "linear-gradient(180deg,#fff,#f7faf9)" }}>
          <div className="eyebrow mb-3">A candidate&apos;s journey</div>
          <ol className="grid gap-2.5">
            {["Register", "Screen", "Shortlist", "Interview and select", "Contract", "Documents and medical", "Visa and travel", "Deployed", "Follow-up"].map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="badge badge-brand" style={{ width: 26, height: 26, justifyContent: "center", padding: 0 }}>{i + 1}</span>
                <span className="font-semibold">{s}</span>
                {i === 4 && <span className="badge badge-good ml-auto">Both contract copies must agree</span>}
                {i === 5 && <span className="badge badge-warn ml-auto">Verified documents required</span>}
                {i === 6 && <span className="badge badge-info ml-auto">Visa and orientation</span>}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="how" className="bg-[#f7f8fa] border-y border-[var(--line)]">
        <div className="max-w-6xl mx-auto px-5 py-14">
          <h2 className="h1 text-center" style={{ fontSize: 28 }}>Everything an agency needs, nothing it does not</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            {FEATURES.map(({ Icon, t, d }) => (
              <div key={t} className="card">
                <div className="stat-icon mb-3"><Icon size={20} /></div>
                <h3 className="h2">{t}</h3>
                <p className="muted mt-1.5">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-14">
        <h2 className="h1 text-center" style={{ fontSize: 28 }}>Simple pricing</h2>
        <p className="muted text-center mt-1">{trialDays()} days free on every plan. Pay monthly by M-Pesa or card.</p>
        <div className="grid md:grid-cols-3 gap-4 mt-8">
          {plans.map((p, i) => (
            <div key={p.code} className="card" style={i === 1 ? { borderColor: "var(--brand)", borderWidth: 2 } : undefined}>
              {i === 1 && <span className="badge badge-brand mb-2">Most agencies choose this</span>}
              <h3 className="h2">{p.name}</h3>
              <div className="text-[30px] font-extrabold tracking-tight mt-1">{formatMoney(p.price_kes_minor)}<span className="muted text-sm font-normal"> / month</span></div>
              <ul className="mt-3 grid gap-1.5">
                <li className="flex gap-2"><Check size={16} className="text-[var(--good)] mt-0.5" /> {p.max_users ?? "Unlimited"} staff accounts</li>
                <li className="flex gap-2"><Check size={16} className="text-[var(--good)] mt-0.5" /> {p.max_candidates ? `${Number(p.max_candidates).toLocaleString("en-KE")} candidates` : "Unlimited candidates"}</li>
                {FEAT.map(([k, l]) => <li key={k} className={`flex gap-2 ${p.features[k] ? "" : "muted line-through"}`}><Check size={16} className={p.features[k] ? "text-[var(--good)] mt-0.5" : "mt-0.5 opacity-30"} /> {l}</li>)}
              </ul>
              {can && <Link href="/signup" className={`btn w-full mt-4 ${i === 1 ? "btn-primary" : ""}`}>Start free trial</Link>}
            </div>
          ))}
        </div>
        <p className="muted text-center text-sm mt-6">Prefer to run it on your own server? Ask about a one-time purchase with your own installation.</p>
      </section>

      <footer className="border-t border-[var(--line)] py-8 text-center muted text-sm">Recruitment Workspace · Already have an account? <Link className="link" href="/login">Sign in</Link></footer>
    </div>
  );
}
