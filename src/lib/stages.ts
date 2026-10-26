export type StageDef = {
  name: string;
  description: string;
  requiredDocTypes: string[];
  requiresPayment: boolean;
  requiresJobOrder: boolean;
  requiresVettedEmployer: boolean;
  marksDeployed: boolean;
  requiresContract: boolean;
  requiresVisa: boolean;
  requiresOrientation: boolean;
  requiresArrival: boolean;
};

const base = { requiredDocTypes: [], requiresPayment: false, requiresJobOrder: false, requiresVettedEmployer: false, marksDeployed: false, requiresContract: false, requiresVisa: false, requiresOrientation: false, requiresArrival: false };

/** The default nine stages. Each agency can change these in the database; they are data, not code. */
export const DEFAULT_STAGES: StageDef[] = [
  { ...base, name: "Register", description: "Registration and consent" },
  { ...base, name: "Screen", description: "Your profile, ID, skills and experience are checked", requiresPayment: true },
  { ...base, name: "Shortlist", description: "Matched to a job and shown to the employer", requiresJobOrder: true },
  { ...base, name: "Interview and select", description: "The employer interviews and chooses", requiresJobOrder: true, requiresVettedEmployer: true },
  { ...base, name: "Contract", description: "Offer made and contract signed", requiresJobOrder: true, requiresVettedEmployer: true, requiresContract: true },
  {
    ...base,
    name: "Documents and medical",
    description: "Passport, police clearance, medical and orientation",
    requiredDocTypes: ["Passport", "Police clearance", "Medical report"],
    requiresPayment: true,
    requiresJobOrder: true,
    requiresVettedEmployer: true,
  },
  { ...base, name: "Visa and travel", description: "Visa application, ticket and travel date", requiresJobOrder: true, requiresVettedEmployer: true, requiresVisa: true, requiresOrientation: true },
  { ...base, name: "Deployed", description: "Travelled and started work", requiresJobOrder: true, requiresVettedEmployer: true, marksDeployed: true, requiresArrival: true },
  { ...base, name: "Follow-up", description: "Check-ins while working abroad, and a way to raise problems", requiresJobOrder: true, requiresVettedEmployer: true },
];

export const DOC_TYPES = [
  "Passport",
  "National ID",
  "Police clearance",
  "Medical report",
  "Academic certificate",
  "Professional certificate",
  "Passport photo",
  "Visa",
  "Contract",
  "Other",
];

export const COST_CATEGORIES = ["Passport", "Medical", "Police clearance", "Training", "Visa", "Flight ticket", "Accommodation", "Other"];
export const FEE_TYPES = ["Registration", "Processing", "Medical", "Training", "Other"];

export const CLOSE_REASONS = ["Completed", "Withdrew", "Failed medical", "Visa refused", "Rejected by employer", "Other"];
