export type Role = "admin" | "recruiter" | "documentation" | "finance" | "employer";

export type Action =
  | "candidates:write"
  | "documents:write"
  | "documents:verify"
  | "employers:write"
  | "joborders:write"
  | "pipeline:move"
  | "pipeline:override"
  | "finance:read"
  | "finance:write"
  | "users:manage";

const GRANTS: Record<Role, Action[] | "all"> = {
  admin: "all",
  recruiter: ["candidates:write", "employers:write", "joborders:write", "pipeline:move"],
  documentation: ["candidates:write", "documents:write", "documents:verify", "pipeline:move"],
  finance: ["finance:read", "finance:write"],
  employer: [], // employers only use the employer portal
};

export function can(role: Role, action: Action): boolean {
  const g = GRANTS[role];
  return g === "all" || g.includes(action);
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Agency admin",
  recruiter: "Recruiter",
  documentation: "Documentation officer",
  finance: "Finance officer",
  employer: "Employer",
};

/** Roles that work for the agency (employers are external). */
export const STAFF_ROLES: Role[] = ["admin", "recruiter", "documentation", "finance"];
