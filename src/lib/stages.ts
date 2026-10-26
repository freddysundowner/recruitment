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

/** The default five stages. Each agency can change these in the database; they are data, not code. */
export const DEFAULT_STAGES: StageDef[] = [
  { ...base, name: "New", description: "Registered, and agreed to share their details" },
  { ...base, name: "With employer", description: "Matched to a job, shown to the employer and interviewed", requiresJobOrder: true },
  { ...base, name: "Selected", description: "The employer chose them and the contract is signed", requiresJobOrder: true, requiresVettedEmployer: true, requiresContract: true },
  {
    ...base,
    name: "Getting ready",
    description: "Documents, medical, fees, visa and orientation",
    requiredDocTypes: ["Passport", "Police clearance", "Medical report"],
    requiresPayment: true,
    requiresJobOrder: true,
    requiresVettedEmployer: true,
    requiresVisa: true,
    requiresOrientation: true,
  },
  { ...base, name: "Abroad", description: "Travelled and started work. Check-in reminders are set for you", requiresJobOrder: true, requiresVettedEmployer: true, marksDeployed: true },
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
