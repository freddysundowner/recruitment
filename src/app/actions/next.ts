"use server";

import { withTenant } from "@/lib/db";
import { getCtx } from "@/lib/session";
import { getAgency, getCandidateCtx } from "@/lib/portal-session";
import { steps, type Step } from "@/lib/next-steps";

const UUID = /^[0-9a-f-]{36}$/;

/** Turns the short code in a page address into the suggestions to show. Unknown or foreign ids give nothing. */
export async function resolveNext(key: string, ref: string | null, slug?: string): Promise<Step | null> {
  if (key === "portal_welcome") {
    if (!slug) return null;
    const agency = await getAgency(slug);
    const me = agency ? await getCandidateCtx(agency.id) : null;
    return me ? steps.portalWelcome(slug) : null;
  }

  const ctx = await getCtx();
  if (!ctx) return null;
  if (key === "request_sent") return ctx.role === "employer" ? steps.employerRequestSent() : null;
  if (key === "welcome") return ctx.role === "admin" ? steps.welcome(ctx.name.split(" ")[0]) : null;
  if (!ref || !UUID.test(ref) || ctx.role === "employer") return null;

  return withTenant(ctx.tenantId, async (tx) => {
    if (key === "candidate_created") {
      const [c] = await tx`SELECT first_name, last_name FROM candidates WHERE id = ${ref}`;
      return c ? steps.candidateCreated(ref, `${c.first_name} ${c.last_name}`) : null;
    }
    if (key === "employer_created") {
      const [e] = await tx`SELECT company FROM employers WHERE id = ${ref}`;
      return e ? steps.employerCreated(ref, e.company) : null;
    }
    if (key === "job_order_created") {
      const [j] = await tx`SELECT title FROM job_orders WHERE id = ${ref}`;
      return j ? steps.jobOrderCreated(ref, j.title) : null;
    }
    return null;
  });
}
