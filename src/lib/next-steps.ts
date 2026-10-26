/**
 * "What next?" suggestions. After an important action the app shows a short dialog with the sensible next moves,
 * so nobody is left wondering what to do. Everything here is plain data built on the server from ids the app
 * already knows, so a link in a dialog can never point outside the app.
 */
export type StepAction = { label: string; hint?: string; href: string; primary?: boolean };
export type Step = { title: string; body?: string; actions: StepAction[] };

const P = (id: string, hash = "") => `/placements/${id}${hash}`;

export const steps = {
  // ------------------------------------------------------------ candidates and documents
  candidateCreated: (id: string, name: string): Step => ({
    title: "Candidate registered",
    body: `${name} is now at the first stage of your pipeline. A good next move is to collect their documents.`,
    actions: [
      { label: "Upload their documents", hint: "Passport, ID, certificates", href: `/candidates/${id}#documents`, primary: true },
      { label: "Match them to a job", hint: "Pick an open job order", href: `/candidates/${id}#placement` },
      { label: "Add another candidate", href: "/candidates/new" },
      { label: "See the pipeline", href: "/pipeline" },
    ],
  }),
  importDone: (created: number): Step => ({
    title: `${created} candidate${created === 1 ? "" : "s"} imported`,
    body: "They are all at the first stage. Check the list, then start collecting documents and matching them to jobs.",
    actions: [
      { label: "Review the new candidates", href: "/candidates", primary: true },
      { label: "Set up your employers and jobs", hint: "So there is something to match them to", href: "/employers" },
      { label: "See the pipeline", href: "/pipeline" },
    ],
  }),
  documentUploaded: (candidateId: string): Step => ({
    title: "Document uploaded",
    body: "It is waiting to be checked. Open it, compare it with the candidate, then verify or reject it.",
    actions: [
      { label: "Verify documents now", href: "/verify", primary: true },
      { label: "Back to the candidate", href: `/candidates/${candidateId}` },
    ],
  }),
  documentReviewed: (candidateId: string, status: "verified" | "rejected"): Step => ({
    title: status === "verified" ? "Document verified" : "Document rejected",
    body: status === "verified" ? "The candidate gets closer to passing the document check." : "Ask the candidate to send a clearer or valid copy.",
    actions: [
      { label: "Next document to verify", href: "/verify", primary: true },
      { label: "Back to the candidate", href: `/candidates/${candidateId}#documents` },
    ],
  }),

  // ------------------------------------------------------------ employers and jobs
  employerCreated: (id: string, name: string): Step => ({
    title: "Employer added",
    body: `Before sending ${name} any candidates, record how you checked them. An employer needs a passed registration check to be marked vetted.`,
    actions: [
      { label: "Record vetting checks", href: `/employers/${id}#checks`, primary: true },
      { label: "Give them a portal login", hint: "So they can review candidates themselves", href: `/employers/${id}#logins` },
      { label: "Create a job order", href: "/job-orders/new" },
    ],
  }),
  employerCheck: (id: string, result: "ok" | "concern"): Step => ({
    title: "Check recorded",
    body: result === "ok" ? "Once the registration check has passed, you can mark the employer as vetted." : "Look into the concern before sending candidates to this employer.",
    actions: [
      { label: "Review the employer", href: `/employers/${id}`, primary: true },
      { label: "Record another check", href: `/employers/${id}#checks` },
    ],
  }),
  employerVetted: (id: string): Step => ({
    title: "Employer is vetted",
    body: "Candidates can now move past the shortlist for this employer's jobs.",
    actions: [
      { label: "Create a job order", href: "/job-orders/new", primary: true },
      { label: "Give them a portal login", href: `/employers/${id}#logins` },
    ],
  }),
  employerLogin: (id: string): Step => ({
    title: "Portal login created",
    body: "Share the temporary password privately. They sign in at the usual sign-in page and are taken to their own portal.",
    actions: [
      { label: "Create a job order for them", href: "/job-orders/new", primary: true },
      { label: "Back to the employer", href: `/employers/${id}` },
    ],
  }),
  jobOrderCreated: (id: string, title: string): Step => ({
    title: "Job order created",
    body: `"${title}" is open. Match candidates to it from their profile, or let candidates apply on their portal.`,
    actions: [
      { label: "Find candidates to match", href: "/candidates", primary: true },
      { label: "Share your candidate page", hint: "Candidates can apply online", href: "/settings/general" },
      { label: "Open the job order", href: `/job-orders/${id}` },
    ],
  }),
  jobOrderApproved: (id: string): Step => ({
    title: "Job order is open",
    body: "Candidates can now be matched to it.",
    actions: [{ label: "Find candidates to match", href: "/candidates", primary: true }, { label: "Back to the job order", href: `/job-orders/${id}` }],
  }),

  // ------------------------------------------------------------ pipeline
  jobAssigned: (placementId: string): Step => ({
    title: "Job order assigned",
    body: "Now move the candidate to the Shortlist stage. That shows them to the employer and sends the employer an email.",
    actions: [
      { label: "Move to Shortlist", href: P(placementId, "#stage"), primary: true },
      { label: "Add documents first", hint: "So the employer sees a complete profile", href: P(placementId, "#checklist") },
    ],
  }),
  stageMoved: (placementId: string, position: number, stage: string, candidateId: string): Step => {
    const here = P(placementId);
    const base = { title: `Moved to ${stage}`, actions: [] as StepAction[] };
    const common: StepAction[] = [{ label: "Back to the pipeline", href: "/pipeline" }];
    switch (position) {
      case 2: return { ...base, body: "Check the candidate's ID, skills and experience. If they pay fees, add them now.", actions: [{ label: "Add a fee", href: P(placementId, "#fees"), primary: true }, { label: "Match to a job order", href: `/candidates/${candidateId}#placement` }, ...common] };
      case 3: return { ...base, body: "The employer can now see this candidate and has been emailed. Wait for their decision, or book an interview yourself.", actions: [{ label: "Book an interview", href: P(placementId, "#appointments"), primary: true }, ...common] };
      case 4: return { ...base, body: "Book the interview and tell the candidate. When the employer is happy, move on to the contract.", actions: [{ label: "Book an appointment", href: P(placementId, "#appointments"), primary: true }, ...common] };
      case 5: return { ...base, body: "Record both copies of the contract: the candidate's and the employer's. If they differ, the system stops you moving on.", actions: [{ label: "Record contract copies", href: P(placementId, "#contract"), primary: true }, ...common] };
      case 6: return { ...base, body: "Collect and verify the passport, police clearance and medical report.", actions: [{ label: "Verify documents", href: "/verify", primary: true }, { label: "See the checklist", href: P(placementId, "#checklist") }, ...common] };
      case 7: return { ...base, body: "Record the visa application and the pre-departure orientation. Both are needed before travel.", actions: [{ label: "Record visa and travel", href: P(placementId, "#travel"), primary: true }, ...common] };
      case 8: return { ...base, body: "The worker has travelled. Raise the employer's invoice, and follow-up check-ins have been scheduled for you.", actions: [{ label: "Raise the invoice", href: P(placementId, "#invoices"), primary: true }, { label: "See follow-up", href: "/follow-up" }, ...common] };
      case 9: return { ...base, body: "Keep in touch with the worker. Record each check-in as it happens, and close the case when the contract is complete.", actions: [{ label: "See follow-up", href: "/follow-up", primary: true }, { label: "Open the placement", href: here }] };
      default: return { ...base, actions: [{ label: "Open the placement", href: here, primary: true }, ...common] };
    }
  },
  placementClosed: (candidateId: string): Step => ({
    title: "Placement closed",
    body: "The costs stay on the ledger. If the candidate is still looking, match them to another job.",
    actions: [{ label: "Match to another job", href: `/candidates/${candidateId}#placement`, primary: true }, { label: "Back to the pipeline", href: "/pipeline" }],
  }),
  applicationDecided: (placementId: string | null, decision: "shortlisted" | "declined"): Step =>
    decision === "shortlisted" && placementId
      ? { title: "Applicant matched to the job", body: "Move them to Shortlist so the employer can see them.", actions: [{ label: "Move to Shortlist", href: P(placementId, "#stage"), primary: true }, { label: "Back to job orders", href: "/job-orders" }] }
      : { title: "Applicant declined", actions: [{ label: "Back to job orders", href: "/job-orders", primary: true }] },

  // ------------------------------------------------------------ contract, travel, appointments, follow-up
  contractRecorded: (placementId: string, party: "candidate" | "employer", bothRecorded: boolean): Step => ({
    title: "Contract copy recorded",
    body: bothRecorded
      ? "Both copies are in. If the terms agree, the placement can move on to the next stage; if not, the system will show what differs."
      : `Now record the ${party === "candidate" ? "employer's" : "candidate's"} copy, so the two can be compared.`,
    actions: bothRecorded
      ? [{ label: "Move to the next stage", href: P(placementId, "#stage"), primary: true }, { label: "Back to the placement", href: P(placementId) }]
      : [{ label: `Record the ${party === "candidate" ? "employer's" : "candidate's"} copy`, href: P(placementId, "#contract"), primary: true }],
  }),
  travelSaved: (placementId: string): Step => ({
    title: "Visa and travel saved",
    body: "When the visa is approved and orientation is done, the placement can move on to Deployed.",
    actions: [{ label: "Move to the next stage", href: P(placementId, "#stage"), primary: true }, { label: "Book orientation", href: P(placementId, "#appointments") }],
  }),
  appointmentAdded: (placementId: string): Step => ({
    title: "Appointment booked",
    body: "Record the result after it happens, so the file stays up to date. Reminders go out automatically.",
    actions: [{ label: "See upcoming appointments", href: "/follow-up", primary: true }, { label: "Back to the placement", href: P(placementId) }],
  }),
  checkinDone: (): Step => ({
    title: "Check-in recorded",
    body: "If the worker raised a concern, record it as a complaint so someone owns it.",
    actions: [{ label: "See what else is due", href: "/follow-up", primary: true }, { label: "Open complaints", href: "/complaints" }],
  }),
  complaintRecorded: (): Step => ({
    title: "Complaint recorded",
    body: "Every complaint needs an answer. Update its status as you work on it.",
    actions: [{ label: "Open complaints", href: "/complaints", primary: true }],
  }),

  // ------------------------------------------------------------ money
  costAdded: (placementId: string, employerPaid: boolean): Step => ({
    title: "Cost recorded",
    body: employerPaid ? "This adds to the money the agency has out until the employer repays. You can raise the invoice at any time." : "It is on the ledger for this placement.",
    actions: [
      ...(employerPaid ? [{ label: "Raise the employer invoice", href: P(placementId, "#invoices"), primary: true }] : []),
      { label: "Add another cost", href: P(placementId, "#costs") },
      { label: "See cash exposure", href: "/finance" },
    ],
  }),
  feeAdded: (placementId: string): Step => ({
    title: "Fee added",
    body: "The candidate is reminded before it is due. You can ask for payment by M-Pesa straight away.",
    actions: [{ label: "Ask for M-Pesa payment", href: P(placementId, "#mpesa"), primary: true }, { label: "Record a cash payment", href: P(placementId, "#invoices") }],
  }),
  invoiceRaised: (placementId: string): Step => ({
    title: "Invoice raised",
    body: "When the employer pays, record the payment against the invoice. Partial payments are fine.",
    actions: [{ label: "Record a payment", href: P(placementId, "#invoices"), primary: true }, { label: "See receivables", href: "/finance" }],
  }),
  paymentRecorded: (placementId: string, receipt: string): Step => ({
    title: `Payment recorded, ${receipt}`,
    body: "A receipt number was issued. Candidates are sent a message with it.",
    actions: [{ label: "Move the placement forward", href: P(placementId, "#stage"), primary: true }, { label: "See finance", href: "/finance" }],
  }),
  mpesaRequested: (placementId: string): Step => ({
    title: "M-Pesa request sent",
    body: "The customer will get a prompt on their phone. The payment is recorded automatically when they enter their PIN.",
    actions: [{ label: "Check its status", href: P(placementId, "#mpesa"), primary: true }, { label: "Back to the pipeline", href: "/pipeline" }],
  }),

  // ------------------------------------------------------------ settings and team
  userAdded: (): Step => ({
    title: "Team member added",
    body: "Ask them to sign in and turn on two-step sign-in. You can require it for everyone in Settings.",
    actions: [{ label: "Require two-step sign-in", href: "/settings/security", primary: true }, { label: "Add another person", href: "/settings/team" }],
  }),
  mpesaSettingsSaved: (): Step => ({
    title: "M-Pesa is set up",
    body: "Try it with a small amount first: open a candidate who owes a fee and ask for payment.",
    actions: [{ label: "Open the pipeline", href: "/pipeline", primary: true }],
  }),
  checklistSaved: (): Step => ({
    title: "Checklist saved",
    body: "It now applies to every candidate heading to that country, at the stage that checks documents.",
    actions: [{ label: "Back to the pipeline", href: "/pipeline", primary: true }, { label: "Add another country", href: "/settings/pipeline" }],
  }),
  welcome: (name: string): Step => ({
    title: `Welcome, ${name}`,
    body: "Your workspace is ready. The quickest way to see how everything fits together is to explore with sample data, which you can remove at any time.",
    actions: [
      { label: "Explore with sample data", hint: "A few candidates, employers and jobs to click through", href: "/getting-started", primary: true },
      { label: "Start with my own candidates", href: "/candidates/import" },
      { label: "Set up my team and settings", href: "/settings/team" },
    ],
  }),
  sampleLoaded: (): Step => ({
    title: "Sample data is ready",
    body: "You will find candidates at different stages, two employers and some job orders. Open the pipeline and move someone forward to see how the gates work.",
    actions: [
      { label: "Open the pipeline", href: "/pipeline", primary: true },
      { label: "Look at the candidate portal", href: "/settings/general" },
      { label: "Back to the dashboard", href: "/" },
    ],
  }),

  // ------------------------------------------------------------ employer portal
  employerInterview: (): Step => ({
    title: "Interview requested",
    body: "The candidate has been told. You will see the result here once the agency records it.",
    actions: [{ label: "Back to your job orders", href: "/employer", primary: true }],
  }),
  employerSelected: (jobId: string): Step => ({
    title: "Candidate selected",
    body: "Now record the terms of the contract you signed, so the agency can compare them with the worker's copy before travel.",
    actions: [{ label: "Record contract terms", href: `/employer/jobs/${jobId}#contracts`, primary: true }, { label: "Back to your job orders", href: "/employer" }],
  }),
  employerContract: (): Step => ({
    title: "Contract terms recorded",
    body: "The agency will compare them with the worker's copy. You will be told if anything differs.",
    actions: [{ label: "Back to your job orders", href: "/employer", primary: true }, { label: "Request more workers", href: "/employer/request" }],
  }),
  employerRequestSent: (): Step => ({
    title: "Request sent to the agency",
    body: "The agency will check the details and agree the fee, then open the job order. You will get an email when candidates are ready to review.",
    actions: [{ label: "Back to your job orders", href: "/employer", primary: true }],
  }),

  // ------------------------------------------------------------ candidate portal (slug is the agency address)
  portalWelcome: (slug: string): Step => ({
    title: "You are registered",
    body: "Next, send your documents and look at the jobs. The more complete your profile, the sooner the agency can place you.",
    actions: [
      { label: "Send my documents", hint: "Passport, ID, certificates", href: `/c/${slug}/documents`, primary: true },
      { label: "See open jobs", href: `/c/${slug}/jobs` },
      { label: "Finish my profile", href: `/c/${slug}/me` },
    ],
  }),
  portalDocument: (slug: string): Step => ({
    title: "Document sent",
    body: "The agency will check it and let you know. While you wait, you can apply for jobs.",
    actions: [{ label: "See open jobs", href: `/c/${slug}/jobs`, primary: true }, { label: "Send another document", href: `/c/${slug}/documents` }],
  }),
  portalApplied: (slug: string): Step => ({
    title: "Application sent",
    body: "The agency will review it. Make sure your documents are uploaded so they can move quickly.",
    actions: [{ label: "Check my documents", href: `/c/${slug}/documents`, primary: true }, { label: "Back to my progress", href: `/c/${slug}/home` }],
  }),
  portalComplaint: (slug: string): Step => ({
    title: "We received your complaint",
    body: "The agency has been told. You can follow its progress on the Help page and you will be sent a message.",
    actions: [{ label: "Back to my progress", href: `/c/${slug}/home`, primary: true }],
  }),
  portalPay: (slug: string): Step => ({
    title: "Check your phone",
    body: "Enter your M-Pesa PIN to finish. Your receipt will appear on the Payments page as soon as it is confirmed.",
    actions: [{ label: "See my payments", href: `/c/${slug}/payments`, primary: true }],
  }),
};

export type NextKey = "candidate_created" | "employer_created" | "job_order_created" | "welcome" | "request_sent" | "portal_welcome";
