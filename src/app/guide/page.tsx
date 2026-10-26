import type { Metadata } from "next";
import Link from "next/link";
import { Globe2 } from "lucide-react";
import { getCtx } from "@/lib/session";
import { SITE, jsonLd, siteUrl } from "@/lib/site";

const TITLE = "How to use Recruitment Workspace: a simple step-by-step guide";
const DESCRIPTION = "A simple guide for agency staff: set up, add employers and candidates, follow the nine steps, collect fees by M-Pesa and check in after travel.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guide" },
  openGraph: { type: "article", url: "/guide", title: TITLE, description: DESCRIPTION, siteName: SITE.name, locale: "en_KE" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const TOC: [string, string][] = [
  ["quick-start", "Start here"],
  ["set-up", "1. Set up"],
  ["employers", "2. Employers and jobs"],
  ["candidates", "3. Candidates"],
  ["stages", "4. The nine steps"],
  ["money", "5. Money"],
  ["after", "6. After they travel"],
  ["portals", "7. Their own pages"],
  ["messages", "8. Texts and credits"],
  ["daily", "9. Each day"],
];

const STAGES: [string, string][] = [
  ["Register", "Write down who they are. Tick that they agree to you keeping their details."],
  ["Screen", "Check their ID, skills and work history. Fees that are due must be paid before they leave this step."],
  ["Shortlist", "Match them to a job. Now the employer can see them."],
  ["Interview and select", "The employer talks to them and picks. Check the employer first."],
  ["Contract", "Save the contract the worker has and the one the employer has. They must say the same thing."],
  ["Documents and medical", "Upload and check the passport, police clearance and medical report. Fees must be paid."],
  ["Visa and travel", "The visa must be approved. The worker must finish orientation."],
  ["Deployed", "The worker has travelled. Confirm they arrived."],
  ["Follow-up", "Call them from time to time. Answer any complaint."],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="h1 mt-12 mb-4" style={{ fontSize: 26, scrollMarginTop: 80 }}>{children}</h2>;
}
function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="grid gap-3 list-decimal pl-5 marker:font-bold marker:text-[var(--brand)] text-[16px]">{children}</ol>;
}
function Tip({ children }: { children: React.ReactNode }) {
  return <div className="notice mt-4 text-[15px]"><b>Tip: </b>{children}</div>;
}
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return <div className="card text-[16px]">{title && <h3 className="h2 mb-2">{title}</h3>}{children}</div>;
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
        <div className="w-full px-5 lg:px-10 py-3.5 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-[17px]"><span className="brand-mark"><Globe2 size={18} /></span> {SITE.name}</Link>
          {signedIn ? <Link href="/" className="btn">Back to the app</Link> : <Link href="/login" className="btn">Sign in</Link>}
        </div>
      </header>

      <div className="w-full px-5 lg:px-10 py-10 grid lg:grid-cols-[220px_1fr] gap-10">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-6">
            <div className="eyebrow mb-2">On this page</div>
            <ul className="grid gap-1 text-sm">
              {TOC.map(([id, label]) => <li key={id}><a href={`#${id}`} className="block py-1 muted hover:text-[var(--brand)]">{label}</a></li>)}
            </ul>
          </div>
        </nav>

        <main className="min-w-0 w-full text-[16px] leading-relaxed">
          <nav aria-label="Breadcrumb" className="muted text-sm mb-3"><Link className="link" href="/">Home</Link> / Guide</nav>
          <h1 style={{ fontSize: 38, lineHeight: 1.15, letterSpacing: "-0.02em", fontWeight: 800 }}>How to use {SITE.name}</h1>
          <p className="muted mt-3 text-[18px]">This guide is short and simple. You do not have to read all of it. After every step, the system tells you what to do next.</p>

          <H2 id="quick-start">Start here</H2>
          <Card title="Your first ten minutes">
            <Steps>
              <li><b>Add your staff.</b> Go to Settings, then Team. Pick a role for each person.</li>
              <li><b>Add an employer.</b> Go to Employers. Write down how you checked them.</li>
              <li><b>Add a job.</b> Go to Job orders. Say what job it is, which country, and how many people.</li>
              <li><b>Add your candidates.</b> Go to Candidates. Add one at a time, or load a whole spreadsheet.</li>
              <li><b>Open a candidate.</b> The box at the top says what to do next.</li>
              <li><b>Share your link.</b> It is in Settings, then General. Candidates use it to sign up on their phones.</li>
            </Steps>
            <Tip>Want to practise first? Use the sample data on the Getting started page. You can delete it with one button.</Tip>
          </Card>

          <H2 id="set-up">1. Set up</H2>
          <p>Everything here is in <b>Settings</b>. Pick a part on the left.</p>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            <Card title="General">Your agency name and colour. Your link for candidates.</Card>
            <Card title="Team">Add your staff. Recruiters work with candidates. Document staff check papers. Finance staff handle money. Admins can do everything.</Card>
            <Card title="Pipeline and checklists">Say which papers each country needs. Switch on two optional rules when you are ready: use only checked employers, and compare the two contracts.</Card>
            <Card title="Payments">Add your M-Pesa paybill or till. Then candidates can pay fees from their phones.</Card>
            <Card title="Messages">Pick how you contact candidates. Add your own sender name. See your text credits.</Card>
            <Card title="Security">Turn on two-step sign-in for everyone. It keeps accounts safe.</Card>
          </div>

          <H2 id="employers">2. Employers and jobs</H2>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Add an employer">
              <Steps>
                <li>Go to <b>Employers</b>. Press <b>Add employer</b>.</li>
                <li>Write the company name, country and contact person.</li>
                <li>On the employer page, write down a <b>check</b>. For example, you confirmed the company is real.</li>
                <li>When the check is good, press <b>Mark as vetted</b>.</li>
              </Steps>
            </Card>
            <Card title="Add a job">
              <Steps>
                <li>Go to <b>Job orders</b>. Press <b>New job order</b>.</li>
                <li>Pick the employer. Write the job, the country and how many workers.</li>
                <li>Choose <b>who pays the costs</b>. Either the employer pays you back later, or the candidate pays you.</li>
              </Steps>
            </Card>
          </div>
          <Tip>Employers can have their own login. They can look at candidates and ask you for more workers.</Tip>

          <H2 id="candidates">3. Candidates</H2>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Add a candidate">
              <Steps>
                <li>Go to <b>Candidates</b>.</li>
                <li>Press <b>Add candidate</b> for one person. Press <b>Import CSV</b> for many people.</li>
                <li>Tick the box that says they agree to you keeping their details.</li>
              </Steps>
              <p className="mt-3">Candidates can also sign up by themselves with your link.</p>
            </Card>
            <Card title="Papers">
              <Steps>
                <li>Open the candidate. Upload their papers, such as passport and ID.</li>
                <li>Write the date each paper ends. You will get a warning before it does.</li>
                <li>Go to <b>Verify documents</b>. Look at each paper. Press <b>Verify</b> if it is good, or <b>Reject</b> if it is not.</li>
              </Steps>
            </Card>
          </div>

          <H2 id="stages">4. The nine steps</H2>
          <p>Every candidate is on one of nine steps. Open a candidate and read the box at the top. It shows what is missing and what is done. When nothing is missing, the button for the next step turns on.</p>
          <div className="card p-0 overflow-x-auto mt-4">
            <table className="table">
              <thead><tr><th>Step</th><th>What you need</th></tr></thead>
              <tbody>{STAGES.map(([s, d], i) => <tr key={s}><td className="whitespace-nowrap font-semibold">{i + 1}. {s}</td><td>{d}</td></tr>)}</tbody>
            </table>
          </div>
          <Tip>Only an admin can skip a rule. The admin must write why. It is saved.</Tip>

          <H2 id="money">5. Money</H2>
          <p>Money is on each candidate page, in the box called <b>Money</b>. What you see depends on who pays.</p>
          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <Card title="If the employer pays">
              <Steps>
                <li>Write down each <b>cost</b> when you pay it. For example passport, medical, visa and flight. You cannot change a cost later. You can only cancel it with a new entry.</li>
                <li>Send the employer an <b>invoice</b>.</li>
                <li>When they pay, write down the <b>payment</b>. They can pay a little at a time.</li>
              </Steps>
            </Card>
            <Card title="If the candidate pays">
              <Steps>
                <li>Add the <b>fees</b> and the date each is due. The candidate gets a reminder.</li>
                <li>Ask for payment by <b>M-Pesa</b>. A message pops up on their phone. They type their PIN.</li>
                <li>The system saves the payment and sends a <b>receipt</b>.</li>
              </Steps>
            </Card>
          </div>
          <p className="mt-4">The <b>Finance</b> page shows money you spent, money employers owe you, and money you got. The <b>Reports</b> page shows your profit for each worker.</p>

          <H2 id="after">6. After they travel</H2>
          <p>When a candidate reaches <b>Deployed</b>, the system plans three check-ins for you. They are after 30, 90 and 180 days. They show on the <b>To do</b> page when it is time. Call the worker. Then write down how they are: well, a worry, or could not reach.</p>
          <p className="mt-3">Workers can send a complaint from their own page. You can also write one for them. Each complaint stays on your To do list until you close it and say how you fixed it.</p>

          <H2 id="portals">7. Their own pages</H2>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Candidates">They sign in with a code sent to their phone. They see their step, what to send, their appointments and their payments. They can also apply for jobs.</Card>
            <Card title="Employers">They sign in with the login you gave them. They look at candidates, ask for interviews and pick workers. They also save the contract they signed.</Card>
          </div>

          <H2 id="messages">8. Texts and credits</H2>
          <p>The system sends messages for you. It does this when a candidate moves to a new step, when an appointment is set, when a fee is due, and when a paper is about to end. See all messages on the <b>Messages</b> page.</p>
          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <Card title="Credits">
              <ul className="grid gap-2 list-disc pl-5">
                <li>One text uses <b>one credit</b>. A long text uses more.</li>
                <li>New agencies get free credits to start.</li>
                <li>To get more, go to <b>Billing</b>. Pick an amount and pay by M-Pesa. Credits are added as soon as the payment goes through.</li>
                <li>If you run out, texts are not sent until you buy more. Emails cost nothing.</li>
              </ul>
            </Card>
            <Card title="Your own sender name">
              <p>Go to Settings, then Messages. Add the name you want on your texts and the email address you want on your emails. They are checked first. Until then we use ours.</p>
            </Card>
          </div>

          <H2 id="daily">9. Each day</H2>
          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Start on To do">It lists papers to check, people waiting for an answer, check-ins that are due and complaints. The most important ones are first.</Card>
            <Card title="Use Pipeline">See everyone by step. Find the people who have waited the longest.</Card>
            <Card title="Use search">Type a name, phone number or ID at the top to find a candidate fast.</Card>
            <Card title="Use Reports">See how far your candidates get and where you earn money.</Card>
          </div>

          <div className="card mt-12 text-center" style={{ padding: 28 }}>
            <h2 className="h1" style={{ fontSize: 24 }}>Ready to try it?</h2>
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
