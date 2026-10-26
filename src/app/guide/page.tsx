import type { Metadata } from "next";
import Link from "next/link";
import { Globe2 } from "lucide-react";
import { getCtx } from "@/lib/session";
import { SITE, jsonLd, siteUrl } from "@/lib/site";

const TITLE = "How to use Recruitment Workspace: a simple step-by-step guide";
const DESCRIPTION = "A plain guide for agency staff: set up, add employers and candidates, work through the nine stages, collect fees by M-Pesa and follow up.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guide" },
  openGraph: { type: "article", url: "/guide", title: TITLE, description: DESCRIPTION, siteName: SITE.name, locale: "en_KE" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const TOC: [string, string][] = [
  ["quick-start", "Quick start"],
  ["set-up", "1. Set up your agency"],
  ["employers", "2. Employers and job orders"],
  ["candidates", "3. Candidates and documents"],
  ["stages", "4. The nine stages"],
  ["money", "5. Money"],
  ["after", "6. After they fly"],
  ["portals", "7. Candidate and employer pages"],
  ["messages", "8. Messages and SMS credits"],
  ["daily", "9. Every day"],
];

const STAGES: [string, string][] = [
  ["Register", "Their details and their consent to keep them."],
  ["Screen", "Check their ID, skills and experience. Any fees that are due must be paid before they leave this stage."],
  ["Shortlist", "They are matched to a job order. This is when the employer can see them."],
  ["Interview and select", "The employer interviews and chooses. The employer should be vetted first."],
  ["Contract", "Record the candidate's copy and the employer's copy of the contract. They must agree."],
  ["Documents and medical", "Passport, police clearance and medical report must be uploaded and verified. Fees must be paid."],
  ["Visa and travel", "The visa must be approved and the orientation done."],
  ["Deployed", "They have travelled. Confirm their arrival."],
  ["Follow-up", "Check in on them while they work, and answer any complaint."],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="h1 mt-12 mb-3" style={{ fontSize: 24, scrollMarginTop: 80 }}>{children}</h2>;
}
function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="grid gap-2.5 list-decimal pl-5 marker:font-bold marker:text-[var(--brand)]">{children}</ol>;
}
function Tip({ children }: { children: React.ReactNode }) {
  return <div className="notice mt-3">{children}</div>;
}

export default async function Guide() {
  const signedIn = Boolean(await getCtx());
  const base = siteUrl();
  const structured = [
    { "@context": "https://schema.org", "@type": "Article", headline: TITLE, description: DESCRIPTION, inLanguage: "en", mainEntityOfPage: `${base}/guide`, author: { "@type": "Organization", name: SITE.name }, publisher: { "@type": "Organization", name: SITE.name } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: SITE.name, item: `${base}/` }, { "@type": "ListItem", position: 2, name: "Guide", item: `${base}/guide` }] },
  ];

  return (
    <div className="min-h-screen bg-white">
      {structured.map((s, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(s) }} />)}
      <header className="border-b border-[var(--line)]">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-[17px]"><span className="brand-mark"><Globe2 size={18} /></span> {SITE.name}</Link>
          {signedIn ? <Link href="/" className="btn">Back to the app</Link> : <Link href="/login" className="btn">Sign in</Link>}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 py-10 grid lg:grid-cols-[220px_1fr] gap-10">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-6">
            <div className="eyebrow mb-2">On this page</div>
            <ul className="grid gap-1 text-sm">
              {TOC.map(([id, label]) => <li key={id}><a href={`#${id}`} className="block py-1 muted hover:text-[var(--brand)]">{label}</a></li>)}
            </ul>
          </div>
        </nav>

        <main className="max-w-3xl min-w-0">
          <nav aria-label="Breadcrumb" className="muted text-sm mb-3"><Link className="link" href="/">Home</Link> / Guide</nav>
          <h1 style={{ fontSize: 36, lineHeight: 1.15, letterSpacing: "-0.02em", fontWeight: 800 }}>How to use {SITE.name}</h1>
          <p className="muted mt-3 text-[17px]">A plain guide for agency staff. You do not need to read all of it. The system tells you what to do next after every step, and this page is here when you want the bigger picture.</p>

          <H2 id="quick-start">Quick start</H2>
          <div className="card">
            <p>If you only have ten minutes, do these in order:</p>
            <Steps>
              <li><b>Add your team</b> in Settings, Team. Give each person the role that fits their work.</li>
              <li><b>Add an employer</b> in Employers, and record how you checked them.</li>
              <li><b>Create a job order</b> in Job orders: the role, the country, how many workers and who pays the costs.</li>
              <li><b>Add your candidates</b> in Candidates, one by one or all at once from a spreadsheet.</li>
              <li><b>Open a candidate.</b> The box at the top, &ldquo;Do this now&rdquo;, lists what is left before they can move on.</li>
              <li><b>Share your candidate page</b> from Settings, General, so people can register from their phones.</li>
            </Steps>
            <Tip>New to the system? Use the sample data on the Getting started page to click around safely. You can remove it with one button.</Tip>
          </div>

          <H2 id="set-up">1. Set up your agency</H2>
          <p>Everything here is under <b>Settings</b>. The left side lists the sections.</p>
          <ul className="grid gap-2 mt-3 list-disc pl-5">
            <li><b>General:</b> your agency&apos;s name, colour, and the web address candidates use to register.</li>
            <li><b>Team:</b> add staff. Recruiters work with candidates, documentation officers check documents, finance officers handle money, and admins can do everything.</li>
            <li><b>Pipeline and checklists:</b> the documents each country needs, and two rules you can switch on when you are ready: only using vetted employers, and comparing contract copies.</li>
            <li><b>Payments:</b> your M-Pesa paybill or till, so candidates can pay fees from their phones.</li>
            <li><b>Messages:</b> choose how candidates are contacted, connect your own sender name, and see your SMS credits.</li>
            <li><b>Security:</b> turn on two-step sign-in for everyone.</li>
          </ul>

          <H2 id="employers">2. Employers and job orders</H2>
          <Steps>
            <li>Go to <b>Employers</b> and choose <b>Add employer</b>. Enter the company, country and contact.</li>
            <li>On the employer&apos;s page, record a <b>check</b>, such as confirming their registration. When it has passed, choose <b>Mark as vetted</b>.</li>
            <li>Go to <b>Job orders</b> and choose <b>New job order</b>. Pick the employer, the role, the country and how many workers.</li>
            <li>Choose <b>who pays the costs</b>. If the employer pays, you fund the costs first and invoice them later. If the candidate pays, you charge them fees.</li>
          </Steps>
          <Tip>Employers can have their own login. On the employer&apos;s page, create a login and they can review candidates and ask you for more workers themselves.</Tip>

          <H2 id="candidates">3. Candidates and documents</H2>
          <Steps>
            <li>Go to <b>Candidates</b>. Choose <b>Add candidate</b> for one person, or <b>Import CSV</b> to bring in a whole spreadsheet.</li>
            <li>Tick the box to confirm the candidate agreed to you keeping their details.</li>
            <li>Open the candidate and upload their <b>documents</b>: passport, national ID, certificates. Add the expiry date so you get a warning in time.</li>
            <li>Open <b>Verify documents</b> (or the To do page). Look at each file, then choose <b>Verify</b> or <b>Reject</b>.</li>
          </Steps>
          <p className="mt-3">Candidates can also register themselves on your candidate page, send their own documents and apply for jobs.</p>

          <H2 id="stages">4. The nine stages</H2>
          <p>Every candidate is on one of nine stages. Open their page and read the box at the top: it lists what is missing, ticks off what is done, and shows a button for the next stage that unlocks when nothing is left.</p>
          <div className="card p-0 overflow-x-auto mt-3">
            <table className="table">
              <thead><tr><th>Stage</th><th>What it needs</th></tr></thead>
              <tbody>{STAGES.map(([s, d], i) => <tr key={s}><td className="whitespace-nowrap font-semibold">{i + 1}. {s}</td><td>{d}</td></tr>)}</tbody>
            </table>
          </div>
          <Tip>Match a candidate to a job from their page. Only an admin can skip a requirement, and must give a reason that is recorded.</Tip>

          <H2 id="money">5. Money</H2>
          <p>Money is on each candidate&apos;s page, under <b>Money</b>. What you see depends on who pays.</p>
          <h3 className="h2 mt-4">When the employer pays</h3>
          <Steps>
            <li>Record each <b>cost</b> as you pay it: passport, medical, visa, flight. Costs cannot be edited, only reversed, so the record stays honest.</li>
            <li>Raise an <b>invoice</b> to the employer, in their currency.</li>
            <li>When they pay, <b>record the payment</b> against the invoice. Partial payments are fine.</li>
          </Steps>
          <h3 className="h2 mt-4">When the candidate pays</h3>
          <Steps>
            <li>Add the <b>fees</b> and their due dates. The candidate is reminded before each is due.</li>
            <li>Ask for payment by <b>M-Pesa</b>. A prompt appears on their phone and the payment is recorded when they enter their PIN.</li>
            <li>A <b>receipt</b> is issued and sent to them.</li>
          </Steps>
          <p className="mt-3">The <b>Finance</b> page shows the money you have out, what employers owe you, and what came in. <b>Reports</b> shows profit per worker.</p>

          <H2 id="after">6. After they fly</H2>
          <p>When a candidate reaches <b>Deployed</b>, check-ins are scheduled for you after 30, 90 and 180 days. They appear on the <b>To do</b> page when they are due. Call the worker, then record how they are: doing well, a concern, or unreachable.</p>
          <p className="mt-3">Workers can raise a complaint from their own page, or you can record one for them. Every complaint stays on your To do list until you mark it resolved with an explanation.</p>

          <H2 id="portals">7. Candidate and employer pages</H2>
          <ul className="grid gap-2 list-disc pl-5">
            <li><b>Candidates</b> sign in with a code sent to their phone. They see where they are, what they need to send, their appointments and their payments, and they can apply for jobs and ask for their data.</li>
            <li><b>Employers</b> sign in with the login you gave them. They review shortlisted candidates, ask for interviews, select, and record the contract terms they signed.</li>
          </ul>

          <H2 id="messages">8. Messages and SMS credits</H2>
          <p>The system sends messages by itself when a candidate moves forward, an appointment is booked, a fee is due or a document is about to expire. See everything sent on the <b>Messages</b> page.</p>
          <ul className="grid gap-2 mt-3 list-disc pl-5">
            <li>Each text uses <b>one SMS credit</b>. A long text uses more.</li>
            <li>New agencies start with free credits. To top up, open <b>Billing</b>, choose an amount and pay by M-Pesa. The credits are added as soon as the payment is confirmed.</li>
            <li>To send under your own name, go to Settings, Messages and connect your sender ID and email address. They are approved before use.</li>
            <li>If your credits run out, texts are not sent until you top up. Emails are not charged.</li>
          </ul>

          <H2 id="daily">9. Every day</H2>
          <ul className="grid gap-2 list-disc pl-5">
            <li>Start on <b>To do</b>. It lists documents to check, applicants to answer, check-ins due and complaints, with the most urgent first.</li>
            <li>Use <b>Pipeline</b> to see everyone by stage, and find the people who have been waiting longest.</li>
            <li>Use the search box at the top to find a candidate by name, phone or ID number.</li>
            <li>Use <b>Reports</b> to see how far candidates get and where you earn.</li>
          </ul>

          <div className="card mt-12 text-center" style={{ padding: 28 }}>
            <h2 className="h1" style={{ fontSize: 22 }}>Ready to try it?</h2>
            <p className="muted mt-1">Set up your agency in a few minutes.</p>
            <div className="flex justify-center gap-3 mt-4 flex-wrap">
              {signedIn ? <Link href="/" className="btn btn-primary btn-lg">Back to the app</Link> : <><Link href="/signup" className="btn btn-primary btn-lg">Start free</Link><Link href="/" className="btn btn-lg">See the features</Link></>}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
