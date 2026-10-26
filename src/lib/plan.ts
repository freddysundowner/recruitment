import { cache } from "react";
import { withTenant, type Sql } from "./db";
import { getLicense } from "./license";

export type FeatureKey = "candidate_portal" | "employer_portal" | "mpesa" | "whatsapp" | "reports" | "exports";
export type Features = Record<FeatureKey, boolean>;

export type Access = {
  planCode: string;
  planName: string;
  features: Features;
  maxUsers: number | null;
  maxCandidates: number | null;
  /** trialing, active, past_due or cancelled, as stored */
  status: string;
  periodEnd: Date;
  /** Whole days until the paid period ends (negative once it has passed). */
  daysLeft: number;
  /** After the period ends there are 7 days of grace; after that the account is read-only. */
  inGrace: boolean;
  /** False when the agency is suspended, cancelled or past its grace period. */
  writable: boolean;
  tenantStatus: string;
  singleInstall: boolean;
  /** For single installs: what is wrong with, or worth knowing about, the activation key. */
  licenseNote?: string;
};

export const GRACE_DAYS = 7;
export const isSingleInstall = () => process.env.TENANT_MODE === "single";

const ALL: Features = { candidate_portal: true, employer_portal: true, mpesa: true, whatsapp: true, reports: true, exports: true };

export async function loadAccess(tx: Sql, tenantId: string): Promise<Access> {
  if (isSingleInstall()) {
    const lic = await getLicense();
    const base = { planCode: "install", planName: "Single install", features: ALL, maxCandidates: null, status: "active", tenantStatus: "active", singleInstall: true as const };
    if (!lic.ok) return { ...base, maxUsers: null, periodEnd: new Date(0), daysLeft: -9999, inGrace: false, writable: false, licenseNote: lic.message };
    const note = lic.daysLeft !== null && lic.daysLeft <= 30
      ? lic.daysLeft > 0 ? `The activation key ends in ${lic.daysLeft} day${lic.daysLeft === 1 ? "" : "s"}.` : lic.inGrace ? `The activation key ended ${-lic.daysLeft} days ago. Enter a renewed key within ${30 + lic.daysLeft} days to avoid read-only mode.` : "The activation key has ended."
      : undefined;
    return { ...base, maxUsers: lic.users, periodEnd: lic.expires ?? new Date("2999-01-01"), daysLeft: lic.daysLeft ?? 99999, inGrace: lic.inGrace, writable: lic.writable, licenseNote: note };
  }
  const [r] = await tx`
    SELECT t.status AS tenant_status, s.plan_code, s.status, s.current_period_end, p.name, p.features, p.max_users, p.max_candidates
    FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN plans p ON p.code = s.plan_code WHERE t.id = ${tenantId}`;
  return buildAccess(r as never);
}

type Row = {
  tenant_status: string; plan_code: string; status: string; current_period_end: Date | string | null;
  name: string | null; features: Partial<Features> | null; max_users: number | null; max_candidates: number | null;
};

/** The rules, as a pure function so they can be tested with any date. */
export function buildAccess(r: Row, nowMs = Date.now()): Access {
  const periodEnd = new Date(r.current_period_end ?? nowMs);
  const daysLeft = Math.ceil((periodEnd.getTime() - nowMs) / 864e5);
  const expired = daysLeft <= 0;
  const inGrace = expired && daysLeft > -GRACE_DAYS;
  const writable = r.tenant_status === "active" && r.status !== "cancelled" && (!expired || inGrace);
  return {
    planCode: r.plan_code, planName: r.name ?? r.plan_code, features: { ...ALL, ...(r.features ?? {}) } as Features,
    maxUsers: r.max_users, maxCandidates: r.max_candidates, status: r.status, periodEnd, daysLeft, inGrace, writable,
    tenantStatus: r.tenant_status, singleInstall: false,
  };
}

/** The agency's plan and subscription state, looked up once per request. */
export const getAccess = cache((tenantId: string) => withTenant(tenantId, (tx) => loadAccess(tx, tenantId)));

export function lockedMessage(a: Access): string {
  if (a.singleInstall) return a.licenseNote ?? "The activation key has ended, so the system is read-only. Enter a renewed key under Settings.";
  if (a.tenantStatus !== "active") return "This agency account is suspended. Contact support.";
  if (a.status === "cancelled") return "This subscription was cancelled. Renew it on the Billing page to continue.";
  return "Your subscription has ended, so the account is read-only. Renew it on the Billing page to continue.";
}

export async function assertFeature(tenantId: string, key: FeatureKey, label: string) {
  const a = await getAccess(tenantId);
  if (!a.features[key]) throw new Error(`${label} is not part of the ${a.planName} plan. Upgrade on the Billing page.`);
}

export async function assertUserSlot(tx: Sql, tenantId: string) {
  const a = await loadAccess(tx, tenantId);
  if (a.maxUsers === null) return;
  const [{ n }] = await tx`SELECT count(*) AS n FROM users WHERE role <> 'employer' AND status = 'active'`;
  if (Number(n) >= a.maxUsers) throw new Error(`The ${a.planName} plan allows ${a.maxUsers} staff accounts. Upgrade on the Billing page to add more.`);
}

export async function assertCandidateSlots(tx: Sql, tenantId: string, adding = 1) {
  const a = await loadAccess(tx, tenantId);
  if (a.maxCandidates === null) return;
  const [{ n }] = await tx`SELECT count(*) AS n FROM candidates WHERE status <> 'inactive'`;
  if (Number(n) + adding > a.maxCandidates) {
    throw new Error(`The ${a.planName} plan allows ${a.maxCandidates} candidates and you have ${n}. Upgrade on the Billing page to add more.`);
  }
}

