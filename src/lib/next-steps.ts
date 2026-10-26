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
    body: `${name} is in your pipeline. Collect their documents next.`,
    actions: [
      { label: "Upload their documents", hint: "Passport, ID, certificates", href: `/candidates/${id}#documents`, primary: true },
      { label: "Match them to a job", hint: "Pick an open job order", href: `/candidates/${id}#placement` },
      { label: "Add another candidate", href: "/candidates/new" },
      { label: "See the pipeline", href: "/pipeline" },
    ],
  }),
  importDone: (created: number): Step => ({
    title: `${created} candidate${created === 1 ? "" : "s"} imported`,
    body: "They are all at the first stage.",
    actions: [
      { label: "Review the new candidates", href: "/candidates", primary: true },
      { label: "Set up your employers and jobs", hint: "So there is something to match them to", href: "/employers" },
      { label: "See the pipeline", href: "/pipeline" },
    ],
  }),
  documentUploaded: (candidateId: string): Step => ({
    title: "Document uploaded",
    body: "It is waiting to be checked.",
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
    body: `Record how you checked ${name} before sending candidates.`,
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
    body: "Share the temporary password privately.",
    actions: [
      { label: "Create a job order for them", href: "/job-orders/new", primary: true },
      { label: "Back to the employer", href: `/employers/${id}` },
    ],
  }),
  jobOrderCreated: (id: string, title: string): Step => ({
    title: "Job order created",
    body: `"${title}" is open for matching.`,
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
    body: "Next, move them to Shortlist so the employer can see them.",
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
      case 2: return { ...base, body: "Check their ID and skills. Add any fees now.", actions: [{ label: "Add a fee", href: P(placementId, "#fees"), primary: true }, { label: "Match to a job order", href: `/candidates/${candidateId}#placement` }, ...common] };
      case 3: return { ...base, body: "The employer has been told. Wait for their decision.", actions: [{ label: "Book an interview", href: P(placementId, "#appointments"), primary: true }, ...common] };
      case 4: return { ...base, body: "Book the interview and tell the candidate.", actions: [{ label: "Book an appointment", href: P(placementId, "#appointments"), primary: true }, ...common] };
      case 5: return { ...base, body: "Record the candidate's and the employer's contract copies.", actions: [{ label: "Record contract copies", href: P(placementId, "#contract"), primary: true }, ...common] };
      case 6: return { ...base, body: "Verify the passport, police clearance and medical report.", actions: [{ label: "Verify documents", href: "/verify", primary: true }, { label: "See the checklist", href: P(placementId, "#checklist") }, ...common] };
      case 7: return { ...base, body: "Record the visa and the pre-departure orientation.", actions: [{ label: "Record visa and travel", href: P(placementId, "#travel"), primary: true }, ...common] };
      case 8: return { ...base, body: "The worker has travelled. Raise the employer's invoice.", actions: [{ label: "Raise the invoice", href: P(placementId, "#invoices"), primary: true }, { label: "See follow-up", href: "/follow-up" }, ...common] };
      case 9: return { ...base, body: "Record each check-in as it happens.", actions: [{ label: "See follow-up", href: "/follow-up", primary: true }, { label: "Open the placement", href: here }] };
      default: return { ...base, actions: [{ label: "Open the placement", href: here, primary: true }, ...common] };
    }
  },
  placementClosed: (candidateId: string): Step => ({
    title: "Placement closed",
    body: "The costs stay on the ledger.",
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
    body: "Once the visa is approved and orientation is done, they can be deployed.",
    actions: [{ label: "Move to the next stage", href: P(placementId, "#stage"), primary: true }, { label: "Book orientation", href: P(placementId, "#appointments") }],
  }),
  appointmentAdded: (placementId: string): Step => ({
    title: "Appointment booked",
    body: "Record the result after it happens.",
    actions: [{ label: "See upcoming appointments", href: "/follow-up", primary: true }, { label: "Back to the placement", href: P(placementId) }],
  }),
  checkinDone: (): Step => ({
    title: "Check-in recorded",
    body: "If they raised a concern, record it as a complaint.",
    actions: [{ label: "See what else is due", href: "/follow-up", primary: true }, { label: "Open complaints", href: "/complaints" }],
  }),
  complaintRecorded: (): Step => ({
    title: "Complaint recorded",
    body: "Update its status as you work on it.",
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
    body: "The candidate is reminded before it is due.",
    actions: [{ label: "Ask for M-Pesa payment", href: P(placementId, "#mpesa"), primary: true }, { label: "Record a cash payment", href: P(placementId, "#invoices") }],
  }),
  invoiceRaised: (placementId: string): Step => ({
    title: "Invoice raised",
    body: "When the employer pays, record it against the invoice.",
    actions: [{ label: "Record a payment", href: P(placementId, "#invoices"), primary: true }, { label: "See receivables", href: "/finance" }],
  }),
  paymentRecorded: (placementId: string, receipt: string): Step => ({
    title: `Payment recorded, ${receipt}`,
    body: "A receipt number was issued. Candidates are sent a message with it.",
    actions: [{ label: "Move the placement forward", href: P(placementId, "#stage"), primary: true }, { label: "See finance", href: "/finance" }],
  }),
  mpesaRequested: (placementId: string): Step => ({
    title: "M-Pesa request sent",
    body: "They will get a prompt on their phone.",
    actions: [{ label: "Check its status", href: P(placementId, "#mpesa"), primary: true }, { label: "Back to the pipeline", href: "/pipeline" }],
  }),

  // ------------------------------------------------------------ settings and team
  userAdded: (): Step => ({
    title: "Team member added",
    body: "Ask them to sign in and turn on two-step sign-in.",
    actions: [{ label: "Require two-step sign-in", href: "/settings/security", primary: true }, { label: "Add another person", href: "/settings/team" }],
  }),
  mpesaSettingsSaved: (): Step => ({
    title: "M-Pesa is set up",
    body: "Try it with a small amount first.",
    actions: [{ label: "Open the pipeline", href: "/pipeline", primary: true }],
  }),
  checklistSaved: (): Step => ({
    title: "Checklist saved",
    body: "It applies to every candidate going to that country.",
    actions: [{ label: "Back to the pipeline", href: "/pipeline", primary: true }, { label: "Add another country", href: "/settings/pipeline" }],
  }),
  welcome: (name: string): Step => ({
    title: `Welcome, ${name}`,
    body: "Your workspace is ready.",
    actions: [
      { label: "Explore with sample data", hint: "A few candidates, employers and jobs to click through", href: "/getting-started", primary: true },
      { label: "Start with my own candidates", href: "/candidates/import" },
      { label: "Set up my team and settings", href: "/settings/team" },
    ],
  }),
  sampleLoaded: (): Step => ({
    title: "Sample data is ready",
    body: "Candidates, employers and jobs are ready to explore.",
    actions: [
      { label: "Open the pipeline", href: "/pipeline", primary: true },
      { label: "Look at the candidate portal", href: "/settings/general" },
      { label: "Back to the dashboard", href: "/" },
    ],
  }),

  // ------------------------------------------------------------ employer portal
  employerInterview: (): Step => ({
    title: "Interview requested",
    body: "The candidate has been told.",
    actions: [{ label: "Back to your job orders", href: "/employer", primary: true }],
  }),
  employerSelected: (jobId: string): Step => ({
    title: "Candidate selected",
    body: "Now record the terms of the contract you signed.",
    actions: [{ label: "Record contract terms", href: `/employer/jobs/${jobId}#contracts`, primary: true }, { label: "Back to your job orders", href: "/employer" }],
  }),
  employerContract: (): Step => ({
    title: "Contract terms recorded",
    body: "The agency will compare them with the worker's copy.",
    actions: [{ label: "Back to your job orders", href: "/employer", primary: true }, { label: "Request more workers", href: "/employer/request" }],
  }),
  employerRequestSent: (): Step => ({
    title: "Request sent to the agency",
    body: "The agency will check the details and open the job order.",
    actions: [{ label: "Back to your job orders", href: "/employer", primary: true }],
  }),

  // ------------------------------------------------------------ candidate portal (slug is the agency address)
  portalWelcome: (slug: string): Step => ({
    title: "You are registered",
    body: "Next, send your documents and look at the jobs.",
    actions: [
      { label: "Send my documents", hint: "Passport, ID, certificates", href: `/c/${slug}/documents`, primary: true },
      { label: "See open jobs", href: `/c/${slug}/jobs` },
      { label: "Finish my profile", href: `/c/${slug}/me` },
    ],
  }),
  portalDocument: (slug: string): Step => ({
    title: "Document sent",
    body: "The agency will check it and let you know.",
    actions: [{ label: "See open jobs", href: `/c/${slug}/jobs`, primary: true }, { label: "Send another document", href: `/c/${slug}/documents` }],
  }),
  portalApplied: (slug: string): Step => ({
    title: "Application sent",
    body: "The agency will review it.",
    actions: [{ label: "Check my documents", href: `/c/${slug}/documents`, primary: true }, { label: "Back to my progress", href: `/c/${slug}/home` }],
  }),
  portalComplaint: (slug: string): Step => ({
    title: "We received your complaint",
    body: "The agency has been told. You will be sent a message.",
    actions: [{ label: "Back to my progress", href: `/c/${slug}/home`, primary: true }],
  }),
  portalPay: (slug: string): Step => ({
    title: "Check your phone",
    body: "Enter your M-Pesa PIN to finish.",
    actions: [{ label: "See my payments", href: `/c/${slug}/payments`, primary: true }],
  }),

  // ------------------------------------------------------------ the rest of the staff actions
  candidateSaved: (id: string): Step => ({
    title: "Profile saved",
    body: "Check that their documents and job match are up to date.",
    actions: [{ label: "Open their documents", href: `/candidates/${id}#documents`, primary: true }, { label: "Back to the candidate", href: `/candidates/${id}` }, { label: "All candidates", href: "/candidates" }],
  }),
  candidateReopened: (id: string): Step => ({
    title: "Back in the pipeline",
    body: "They are at the first stage again. Match them to a job to carry on.",
    actions: [{ label: "Match to a job", href: `/candidates/${id}#placement`, primary: true }, { label: "See the pipeline", href: "/pipeline" }],
  }),
  costReversed: (placementId: string): Step => ({
    title: "Cost reversed",
    body: "A reversing entry was added; the original stays on record.",
    actions: [{ label: "Add the correct cost", href: P(placementId, "#costs"), primary: true }, { label: "Back to the placement", href: P(placementId) }],
  }),
  mpesaChecked: (placementId: string): Step => ({
    title: "Status checked",
    body: "If it came through, a receipt was recorded.",
    actions: [{ label: "See the payments", href: P(placementId, "#invoices"), primary: true }, { label: "Back to the placement", href: P(placementId, "#mpesa") }],
  }),
  appointmentResult: (placementId: string, result: string): Step => ({
    title: "Result recorded",
    body: result === "passed" ? "Good. If this was the last step before the next stage, you can move the placement on." : result === "pending" ? "It is back to waiting." : "Decide whether to book it again or tell the candidate.",
    actions: [{ label: result === "passed" ? "Move to the next stage" : "Book another appointment", href: P(placementId, result === "passed" ? "#stage" : "#appointments"), primary: true }, { label: "See follow-up", href: "/follow-up" }],
  }),
  stepToggled: (placementId: string, done: boolean): Step => ({
    title: done ? "Marked as done" : "Reopened",
    body: done ? "When every step for this stage is ticked, the placement can move on." : "It no longer counts until you tick it again.",
    actions: [{ label: "Move to the next stage", href: P(placementId, "#stage"), primary: true }, { label: "Back to the placement", href: P(placementId) }],
  }),
  complaintUpdated: (): Step => ({
    title: "Complaint updated",
    body: "The candidate is told when it is resolved.",
    actions: [{ label: "Next complaint", href: "/complaints", primary: true }, { label: "Back to the dashboard", href: "/" }],
  }),
  checklistDeleted: (): Step => ({
    title: "Checklist deleted",
    body: "Candidates going to that country are no longer checked against it.",
    actions: [{ label: "Add a checklist", href: "/settings/pipeline", primary: true }, { label: "Back to the pipeline", href: "/pipeline" }],
  }),
  dataRequestHandled: (): Step => ({
    title: "Request handled",
    body: "The candidate is told the outcome.",
    actions: [{ label: "Back to the requests", href: "/complaints", primary: true }, { label: "See candidates", href: "/candidates" }],
  }),
  candidateErased: (): Step => ({
    title: "Their information was erased",
    body: "Personal details and documents are gone.",
    actions: [{ label: "Back to the requests", href: "/complaints", primary: true }, { label: "See candidates", href: "/candidates" }],
  }),
  jobOrderStatus: (id: string, status: "open" | "closed"): Step => ({
    title: status === "closed" ? "Job order closed" : "Job order reopened",
    body: status === "closed" ? "No new candidates can be matched to it. Those already matched carry on." : "Candidates can be matched to it again.",
    actions: status === "closed"
      ? [{ label: "Back to job orders", href: "/job-orders", primary: true }, { label: "Create a new job order", href: "/job-orders/new" }]
      : [{ label: "Find candidates to match", href: "/candidates", primary: true }, { label: "Open the job order", href: `/job-orders/${id}` }],
  }),
  employerUnvetted: (id: string): Step => ({
    title: "Vetting removed",
    body: "Candidates cannot pass the shortlist until it is vetted again.",
    actions: [{ label: "Record a new check", href: `/employers/${id}#checks`, primary: true }, { label: "Back to the employer", href: `/employers/${id}` }],
  }),
  userStatus: (active: boolean): Step => ({
    title: active ? "Account enabled" : "Account disabled",
    body: active ? "They can sign in again." : "They are signed out and cannot sign in. Their past work stays on record.",
    actions: [{ label: "Back to the team", href: "/settings/team", primary: true }, { label: "Review recent activity", href: "/settings/activity" }],
  }),
  settingsSaved: (what: "general" | "messages" | "security" | "fees" | "rules"): Step => {
    const more: StepAction[] = [
      { label: "Add your team", href: "/settings/team" },
      { label: "Set up M-Pesa", href: "/settings/payments" },
      { label: "Turn on two-step sign-in", href: "/settings/security" },
      { label: "Review pipeline checklists", href: "/settings/pipeline" },
    ].filter((a) => !a.href.endsWith(what === "rules" ? "pipeline" : what));
    return {
      title: "Settings saved",
      body: "It applies straight away.",
      actions: more.slice(0, 3).map((a, i) => ({ ...a, primary: i === 0 })),
    };
  },
  employerDeclined: (): Step => ({
    title: "Candidate declined",
    body: "The agency has been told and will send you other candidates.",
    actions: [{ label: "Back to your job orders", href: "/employer", primary: true }, { label: "Request more workers", href: "/employer/request" }],
  }),
  activationSaved: (): Step => ({
    title: "Activation key saved",
    body: "Your installation is active.",
    actions: [{ label: "Add your team", href: "/settings/team", primary: true }, { label: "Register a candidate", href: "/candidates/new" }],
  }),

  // ------------------------------------------------------------ account and billing
  totpOn: (back: string): Step => ({
    title: "Two-step sign-in is on",
    body: "Copy the recovery codes shown on the page. They are not shown again.",
    actions: [{ label: "Carry on", href: back, primary: true }],
  }),
  totpOff: (back: string): Step => ({
    title: "Two-step sign-in is off",
    body: "Your account is protected by your password alone.",
    actions: [{ label: "Turn it back on", href: "/account/security", primary: true }, { label: "Carry on", href: back }],
  }),
  twoStepCleared: (): Step => ({
    title: "Two-step sign-in cleared",
    body: "They can set it up again when they next sign in.",
    actions: [{ label: "Back to the team", href: "/settings/team", primary: true }, { label: "Security settings", href: "/settings/security" }],
  }),
  passwordChanged: (back: string): Step => ({
    title: "Password changed",
    body: "Use the new password the next time you sign in.",
    actions: [{ label: "Carry on", href: back, primary: true }],
  }),
  subscriptionPrompt: (): Step => ({
    title: "Check your phone",
    body: "Enter your M-Pesa PIN. Your plan updates when it is confirmed.",
    actions: [{ label: "Check the payment status", href: "/billing", primary: true }, { label: "Back to the dashboard", href: "/" }],
  }),
  senderRequested: (approved: boolean): Step => ({
    title: approved ? "Sender saved" : "Sent for approval",
    body: approved ? "It is used for your messages now." : "We will use the platform's sender until it is approved.",
    actions: [{ label: "Back to messages settings", href: "/settings/messages", primary: true }, { label: "Open the dashboard", href: "/" }],
  }),
  creditsPrompt: (): Step => ({
    title: "Check your phone",
    body: "Enter your M-Pesa PIN. Your credits are added when it is confirmed.",
    actions: [{ label: "Check the payment status", href: "/billing#credits", primary: true }, { label: "Back to the dashboard", href: "/" }],
  }),
  subscriptionChecked: (): Step => ({
    title: "Status checked",
    body: "If the payment went through, your plan is already updated.",
    actions: [{ label: "See my plan", href: "/billing", primary: true }, { label: "Back to the dashboard", href: "/" }],
  }),

  // ------------------------------------------------------------ platform console
  tenantUpdated: (tenantId: string, what: string): Step => ({
    title: what,
    body: "The agency sees it straight away.",
    actions: [{ label: "Back to the agency", href: `/platform/tenants/${tenantId}`, primary: true }, { label: "All agencies", href: "/platform/tenants" }, { label: "See payments", href: "/platform/payments" }],
  }),
  platformSaved: (what: string): Step => ({
    title: `${what} saved`,
    body: "It applies straight away.",
    actions: [{ label: "Back to settings", href: "/platform/settings", primary: true }, { label: "Platform overview", href: "/platform" }],
  }),
  senderReviewed: (status: "approved" | "rejected"): Step => ({
    title: status === "approved" ? "Sender approved" : "Sender rejected",
    body: status === "approved" ? "The agency's messages use it from now on." : "The agency keeps using the platform's sender.",
    actions: [{ label: "Back to sender requests", href: "/platform/senders", primary: true }, { label: "Platform overview", href: "/platform" }],
  }),
  planSaved: (): Step => ({
    title: "Plan saved",
    body: "New limits apply to agencies on this plan straight away.",
    actions: [{ label: "Back to the plans", href: "/platform/plans", primary: true }, { label: "See agencies", href: "/platform/tenants" }],
  }),
  adminChanged: (what: string): Step => ({
    title: what,
    actions: [{ label: "Back to administrators", href: "/platform/admins", primary: true }, { label: "Platform overview", href: "/platform" }],
  }),
  platformSecurity: (what: string): Step => ({
    title: what,
    actions: [{ label: "Platform overview", href: "/platform", primary: true }, { label: "My security", href: "/platform/security" }],
  }),

  // ------------------------------------------------------------ candidate portal
  portalWithdrawn: (slug: string): Step => ({
    title: "Application withdrawn",
    body: "You can apply for another job any time.",
    actions: [{ label: "See open jobs", href: `/c/${slug}/jobs`, primary: true }, { label: "Back to my progress", href: `/c/${slug}/home` }],
  }),
  portalProfileSaved: (slug: string): Step => ({
    title: "Profile saved",
    body: "A complete profile helps the agency place you sooner.",
    actions: [{ label: "Send my documents", href: `/c/${slug}/documents`, primary: true }, { label: "See open jobs", href: `/c/${slug}/jobs` }],
  }),
  portalRequestSent: (slug: string): Step => ({
    title: "Request sent",
    body: "The agency will answer it, and you will be sent a message.",
    actions: [{ label: "Back to my progress", href: `/c/${slug}/home`, primary: true }],
  }),
};

export type NextKey = "candidate_created" | "employer_created" | "job_order_created" | "welcome" | "request_sent" | "portal_welcome";
