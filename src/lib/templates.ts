export type TemplateName =
  | "welcome"
  | "otp"
  | "stage_changed"
  | "document_expiring"
  | "fee_due"
  | "payment_received"
  | "appointment"
  | "appointment_reminder"
  | "complaint_received"
  | "employer_shortlist";

type Vars = Record<string, string | number>;

/** Message text for each event. Kept short so it fits in an SMS. */
const T: Record<TemplateName, (v: Vars, brand: string) => { subject: string; body: string }> = {
  welcome: (v, b) => ({
    subject: `Welcome to ${b}`,
    body: `Hello ${v.name}, you are registered with ${b}. We will contact you about suitable jobs abroad. Never pay anyone who is not on our receipt system.`,
  }),
  otp: (v, b) => ({ subject: `${b} sign-in code`, body: `${v.code} is your ${b} sign-in code. It expires in 10 minutes. Do not share it.` }),
  stage_changed: (v, b) => ({
    subject: `Update from ${b}`,
    body: `Hello ${v.name}, your application with ${b} has moved to: ${v.stage}.`,
  }),
  document_expiring: (v, b) => ({
    subject: `Your ${v.doc} is expiring`,
    body: `Hello ${v.name}, your ${v.doc} ${Number(v.days) < 0 ? "has expired" : `expires in ${v.days} days`}. Please renew it and bring the new one to ${b}.`,
  }),
  fee_due: (v, b) => ({
    subject: `Payment reminder from ${b}`,
    body: `Hello ${v.name}, ${v.amount} for ${v.fee} is due on ${v.due}. Pay only through ${b} and always ask for a receipt.`,
  }),
  payment_received: (v, b) => ({
    subject: `Receipt ${v.receipt}`,
    body: `Hello ${v.name}, ${b} received ${v.amount}. Receipt ${v.receipt}. Keep this message.`,
  }),
  appointment: (v, b) => ({
    subject: `${v.kind} booked`,
    body: `Hello ${v.name}, your ${v.kind} with ${b} is booked for ${v.when}${v.where ? ` at ${v.where}` : ""}.`,
  }),
  appointment_reminder: (v, b) => ({
    subject: `Reminder: ${v.kind} tomorrow`,
    body: `Reminder from ${b}: your ${v.kind} is ${v.when}${v.where ? ` at ${v.where}` : ""}.`,
  }),
  complaint_received: (v, b) => ({
    subject: `We received your complaint`,
    body: `Hello ${v.name}, ${b} received your complaint and will respond soon. You can check progress on the candidate portal.`,
  }),
  employer_shortlist: (v, b) => ({
    subject: `New shortlist for ${v.role}`,
    body: `Hello ${v.company}, ${b} has ${v.n} candidate${Number(v.n) === 1 ? "" : "s"} ready for your review for the role ${v.role}. Sign in to the employer portal to review them.`,
  }),
};

export function renderTemplate(name: TemplateName, vars: Vars, brand: string) {
  return T[name](vars, brand);
}

export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
