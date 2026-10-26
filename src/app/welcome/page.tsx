import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, Building2, CalendarCheck, Check, FileCheck2, Globe2, KanbanSquare, MessageSquareText, ShieldCheck, Smartphone, Wallet,
} from "lucide-react";
import { sql } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { isSingleInstall } from "@/lib/plan";
import { getPlatformConfig } from "@/lib/platform-config";
import { getCtx } from "@/lib/session";
import { SITE, jsonLd, siteUrl } from "@/lib/site";

const TITLE = "Recruitment agency software for Kenya | Recruitment Workspace";
const DESCRIPTION = "Run an overseas recruitment agency in one place: candidates, documents, employers, visas and contracts, fees by M-Pesa and follow-up by SMS.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: ["recruitment agency software", "overseas recruitment Kenya", "recruitment management system", "candidate tracking", "M-Pesa recruitment fees", "visa and deployment tracking"],
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", title: TITLE, description: DESCRIPTION, siteName: SITE.name, locale: "en_KE" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

const FEATURES = [
  { Icon: KanbanSquare, t: "A pipeline that follows your rules", d: "Nine stages from registration to follow-up abroad. A candidate cannot move on until documents are verified, fees are paid and the contract copies agree." },
  { Icon: FileCheck2, t: "Documents under control", d: "Passports, medicals and certificates with expiry alerts, a verification queue and a private, audited file store." },
  { Icon: Wallet, t: "Know where your money is", d: "See what you have paid out for employer-paid workers, what each employer owes, and your profit on every placement." },
  { Icon: Smartphone, t: "Candidates on their phones", d: "Candidates register, upload documents, apply for jobs, pay by M-Pesa and follow their progress. No app to install." },
  { Icon: Building2, t: "Employers in the loop", d: "Employers review shortlists, ask for interviews, select, and record their signed terms so differences are caught before travel." },
  { Icon: MessageSquareText, t: "Messages that send themselves", d: "SMS and email for stage changes, appointments, fee reminders and expiring documents, under your own sender name." },
  { Icon: CalendarCheck, t: "Nobody forgotten after they fly", d: "Check-ins are scheduled automatically after deployment, and every complaint has an owner until it is answered." },
  { Icon: ShieldCheck, t: "Your workers' data stays private", d: "Each agency is walled off from the others, ID and passport numbers are encrypted, and every important change is recorded." },
];

const STEPS = [
  { n: "1", t: "Set up in minutes", d: "Create your workspace, add your team, your employers and your job orders. Import your existing candidates from a spreadsheet." },
  { n: "2", t: "Move people through five simple stages", d: "Each candidate's page shows what is missing before the next stage, with a button that unlocks when everything is done." },
  { n: "3", t: "Collect, deploy, follow up", d: "Take fees by M-Pesa, raise invoices to employers, record visa and travel, and keep in touch after deployment." },
];

const FAQ = [
  { q: "Who is this software for?", a: "Agencies that send workers abroad. It covers the whole journey: registering candidates, checking documents, matching them to employers' job orders, contracts, visas and travel, and following up after deployment." },
  { q: "Can candidates pay fees by M-Pesa?", a: "Yes. You connect your own paybill or till number, then ask a candidate to pay from the placement page or let them pay from their own page. The payment is recorded and a receipt is sent automatically." },
  { q: "Does it work on a phone?", a: "Yes. The whole system works on a phone browser, and candidates use a simple page of their own on their phones, with nothing to install." },
  { q: "How does the free trial work?", a: "You get the full system for the trial period with no card needed. You can try it with sample data, or bring your own candidates, and remove the sample at any time." },
  { q: "How do text messages work?", a: "Every new agency starts with free SMS credits. When they run out you buy more by M-Pesa and they are added to your account straight away. You can ask to send under your own sender name." },
  { q: "Is my data safe?", a: "Each agency's records are kept apart from every other agency's. ID and passport numbers are encrypted, uploaded files are private, and the system keeps a record of who did what." },
  { q: "Can I run it on my own server?", a: "Yes. You can buy it once and install it on your own server with your own activation key. Get in touch and we will set it up with you." },
  { q: "Can I bring my existing records?", a: "Yes. Import your candidates from a spreadsheet in one go, then add documents as you go." },
];

export default async function Welcome() {
  if (isSingleInstall()) redirect("/login");
  if (await getCtx()) redirect("/");
  const plans = await sql`SELECT code, name, price_kes_minor, max_users, max_candidates, features FROM plans WHERE active ORDER BY sort`;
  const cfg = await getPlatformConfig();
  const can = cfg.signup.enabled;
  const trial = cfg.signup.trialDays;
  const credit = (cfg.credits.priceMinor / 100).toFixed(2);
  const FEAT: [string, string][] = [["candidate_portal", "Candidate portal"], ["employer_portal", "Employer portal"], ["mpesa", "M-Pesa collection"], ["whatsapp", "WhatsApp messages"]];
  const base = siteUrl();

  const structured = [
    { "@context": "https://schema.org", "@type": "Organization", name: SITE.name, url: base, logo: `${base}/icon` },
    {
      "@context": "https://schema.org", "@type": "SoftwareApplication", name: SITE.name, url: base, description: DESCRIPTION,
      applicationCategory: "BusinessApplication", operatingSystem: "Web browser", inLanguage: "en",
      offers: plans.map((p) => ({ "@type": "Offer", name: p.name, price: (Number(p.price_kes_minor) / 100).toFixed(2), priceCurrency: "KES", url: `${base}/signup`, availability: "https://schema.org/InStock" })),
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];

  return (
    <div className="min-h-screen bg-white">
      {structured.map((s, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(s) }} />)}

      <header className="w-full lg:w-4/5 mx-auto px-5 py-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-[17px]" aria-label={`${SITE.name} home`}><span className="brand-mark"><Globe2 size={18} /></span> {SITE.name}</Link>
        <nav aria-label="Main" className="hidden md:flex items-center gap-6 text-sm font-semibold">
          <a href="#features" className="hover:text-[var(--brand)]">Features</a>
          <a href="#how" className="hover:text-[var(--brand)]">How it works</a>
          <a href="#pricing" className="hover:text-[var(--brand)]">Pricing</a>
          <Link href="/guide" className="hover:text-[var(--brand)]">Guide</Link>
          <a href="#faq" className="hover:text-[var(--brand)]">Questions</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn btn-ghost">Sign in</Link>
          {can && <Link href="/signup" className="btn btn-primary">Start free</Link>}
        </div>
      </header>

      <main>
        <section className="w-full lg:w-4/5 mx-auto px-5 pt-10 pb-14 grid lg:grid-cols-2 gap-10 items-center" aria-labelledby="hero-title">
          <div>
            <h1 id="hero-title" style={{ fontSize: 42, lineHeight: 1.1, letterSpacing: "-0.025em", fontWeight: 800 }}>Run your whole agency, from first registration to a worker settled abroad.</h1>
            <p className="muted mt-4 text-[17px]">Candidates, documents, employers, contracts, visas, M-Pesa and follow-up in one place. It tells you what to do next at every step, so nothing slips.</p>
            <div className="flex gap-3 mt-7 flex-wrap">
              {can ? <Link href="/signup" className="btn btn-primary btn-lg">Start your free {trial}-day trial <ArrowRight size={17} /></Link> : <Link href="/login" className="btn btn-primary btn-lg">Sign in</Link>}
              <Link href="/guide" className="btn btn-lg">See how it works</Link>
            </div>
            <p className="muted text-sm mt-3">No card needed. Try it with sample data, or bring your own and remove the sample any time.</p>
          </div>

          {/* A picture of the main screen, drawn in HTML so it is sharp on every screen and costs no download. */}
          <div className="card" style={{ padding: 22, background: "linear-gradient(180deg,#fff,#f7faf9)" }} role="img" aria-label="Example of a candidate's page showing what is left before the next stage">
            <div className="flex items-center gap-3 mb-3">
              <span className="avatar" style={{ width: 40, height: 40 }}>GA</span>
              <div><div className="font-bold">Grace Achieng</div><div className="muted text-xs">Hotel housekeeper · United Arab Emirates</div></div>
            </div>
            <div className="steps-strip mb-3">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < 3 ? "done" : i === 3 ? "now" : ""} />)}</div>
            <div className="eyebrow mb-1">Do this now · Stage 4 of 5</div>
            <div className="h2">Getting ready</div>
            <ul className="mt-2">
              {[["Passport verified", true], ["Police clearance verified", true], ["Medical report verified", false], ["Fees paid", true]].map(([l, done]) => (
                <li key={String(l)} className={`req ${done ? "done" : ""}`}>
                  <span className="tick"><Check size={13} strokeWidth={3} /></span>
                  <span className="flex-1 font-semibold lbl">{l}</span>
                  {!done && <span className="badge badge-warn">not uploaded yet</span>}
                </li>
              ))}
            </ul>
            <div className="btn btn-primary btn-lg mt-3" style={{ opacity: 0.55, pointerEvents: "none" }} aria-hidden="true">Move to Abroad</div>
          </div>
        </section>

        <section id="features" className="bg-[#f7f8fa] border-y border-[var(--line)]" aria-labelledby="features-title">
          <div className="w-full lg:w-4/5 mx-auto px-5 py-14">
            <h2 id="features-title" className="h1 text-center" style={{ fontSize: 28 }}>Everything an agency needs, nothing it does not</h2>
            <p className="muted text-center mt-1">One system for your staff, your employers and your candidates.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
              {FEATURES.map(({ Icon, t, d }) => (
                <article key={t} className="card">
                  <div className="stat-icon mb-3"><Icon size={20} /></div>
                  <h3 className="h2">{t}</h3>
                  <p className="muted mt-1.5">{d}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="w-full lg:w-4/5 mx-auto px-5 py-14" aria-labelledby="how-title">
          <h2 id="how-title" className="h1 text-center" style={{ fontSize: 28 }}>How it works</h2>
          <ol className="grid md:grid-cols-3 gap-4 mt-8">
            {STEPS.map((s) => (
              <li key={s.n} className="card">
                <span className="badge badge-brand" style={{ width: 30, height: 30, justifyContent: "center", padding: 0 }}>{s.n}</span>
                <h3 className="h2 mt-3">{s.t}</h3>
                <p className="muted mt-1.5">{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="card mt-6" style={{ padding: 22 }}>
            <div className="eyebrow mb-3">A candidate&apos;s journey</div>
            <ol className="grid sm:grid-cols-3 gap-x-6 gap-y-2.5">
              {["New", "With employer", "Selected", "Getting ready", "Abroad"].map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <span className="badge badge-brand" style={{ width: 26, height: 26, justifyContent: "center", padding: 0 }}>{i + 1}</span>
                  <span className="font-semibold">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-center mt-6"><Link href="/guide" className="link font-semibold">Read the step-by-step guide <ArrowRight size={14} className="inline" /></Link></p>
        </section>

        <section id="pricing" className="bg-[#f7f8fa] border-y border-[var(--line)]" aria-labelledby="pricing-title">
          <div className="w-full lg:w-4/5 mx-auto px-5 py-14">
            <h2 id="pricing-title" className="h1 text-center" style={{ fontSize: 28 }}>Simple pricing</h2>
            <p className="muted text-center mt-1">{trial} days free. Pay monthly by M-Pesa or card.</p>
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
                  {can && <Link href="/signup" className={`btn w-full mt-4 ${i === 1 ? "btn-primary" : ""}`}>Start free</Link>}
                </div>
              ))}
            </div>
            <p className="muted text-center text-sm mt-6">
              Texts to candidates use SMS credits: {cfg.credits.freeOnSignup} free to start, then KES {credit} each, bought by M-Pesa. Prefer to run it on your own server? Ask about a one-time purchase.
            </p>
          </div>
        </section>

        <section id="faq" className="max-w-3xl mx-auto px-5 py-14" aria-labelledby="faq-title">
          <h2 id="faq-title" className="h1 text-center" style={{ fontSize: 28 }}>Questions agencies ask</h2>
          <div className="mt-8 grid gap-2">
            {FAQ.map((f) => (
              <details key={f.q} className="card" style={{ padding: "14px 18px" }}>
                <summary className="cursor-pointer font-semibold">{f.q}</summary>
                <p className="muted mt-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="px-5 pb-16">
          <div className="max-w-4xl mx-auto rounded-2xl text-white text-center" style={{ padding: "44px 24px", background: "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 70%, black))" }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Give your next candidate a clear path</h2>
            <p className="mt-2 opacity-90">Set up your agency in minutes and see every candidate&apos;s next step.</p>
            <div className="flex justify-center gap-3 mt-6 flex-wrap">
              {can ? <Link href="/signup" className="btn btn-lg" style={{ background: "white", color: "var(--brand)" }}>Start your free trial</Link> : <Link href="/login" className="btn btn-lg" style={{ background: "white", color: "var(--brand)" }}>Sign in</Link>}
              <Link href="/guide" className="btn btn-lg" style={{ background: "transparent", color: "white", borderColor: "rgba(255,255,255,.5)" }}>Read the guide</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--line)] py-8">
        <nav aria-label="Footer" className="w-full lg:w-4/5 mx-auto px-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold">{SITE.name}</span>
          <Link className="link" href="/guide">Guide</Link>
          <a className="link" href="#pricing">Pricing</a>
          <a className="link" href="#faq">Questions</a>
          <Link className="link" href="/login">Sign in</Link>
          {can && <Link className="link" href="/signup">Start free</Link>}
        </nav>
      </footer>
    </div>
  );
}
