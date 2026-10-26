"use server";

import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireCan } from "@/lib/session";
import { audit } from "@/lib/audit";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { toMinor } from "@/lib/money";
import { notifyCandidate } from "@/lib/notify";
import { fmtDateTime } from "@/lib/templates";

const refresh = (placementId: string) => {
  revalidatePath(`/placements/${placementId}`);
  revalidatePath("/");
};

async function candidateOf(tx: Parameters<Parameters<typeof withTenant>[1]>[0], placementId: string) {
  const [c] = await tx`
    SELECT c.id, c.first_name, c.phone, c.email FROM placements p JOIN candidates c ON c.id = p.candidate_id WHERE p.id = ${placementId}`;
  return { id: c.id as string, name: c.first_name as string, phone: c.phone as string, email: c.email as string | null };
}

// ---------------------------------------------------------------- visa and travel
export async function saveTravel(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    const status = field(fd, "visa_status") ?? "not_started";
    if (!["not_started", "applied", "approved", "refused"].includes(status)) return { error: "Choose a visa status." };
    if (status === "approved" && !field(fd, "visa_number")) return { error: "Enter the visa number for an approved visa." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`
          INSERT INTO placement_travel (placement_id, tenant_id, visa_status, visa_applied_on, visa_decision_on, visa_number, visa_expiry,
            airline, flight_no, ticket_ref, departure_on, departure_airport, orientation_done_on, arrival_confirmed_on, employer_start_on, notes, updated_by)
          VALUES (${placementId}, ${ctx.tenantId}, ${status}, ${field(fd, "visa_applied_on")}, ${field(fd, "visa_decision_on")}, ${field(fd, "visa_number")},
            ${field(fd, "visa_expiry")}, ${field(fd, "airline")}, ${field(fd, "flight_no")}, ${field(fd, "ticket_ref")}, ${field(fd, "departure_on")},
            ${field(fd, "departure_airport")}, ${field(fd, "orientation_done_on")}, ${field(fd, "arrival_confirmed_on")}, ${field(fd, "employer_start_on")},
            ${field(fd, "notes") ?? ""}, ${ctx.userId})
          ON CONFLICT (placement_id) DO UPDATE SET
            visa_status = EXCLUDED.visa_status, visa_applied_on = EXCLUDED.visa_applied_on, visa_decision_on = EXCLUDED.visa_decision_on,
            visa_number = EXCLUDED.visa_number, visa_expiry = EXCLUDED.visa_expiry, airline = EXCLUDED.airline, flight_no = EXCLUDED.flight_no,
            ticket_ref = EXCLUDED.ticket_ref, departure_on = EXCLUDED.departure_on, departure_airport = EXCLUDED.departure_airport,
            orientation_done_on = EXCLUDED.orientation_done_on, arrival_confirmed_on = EXCLUDED.arrival_confirmed_on,
            employer_start_on = EXCLUDED.employer_start_on, notes = EXCLUDED.notes, updated_at = now(), updated_by = EXCLUDED.updated_by`;
        await audit(tx, ctx, "travel.save", "placement", placementId, { visa: status });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Saved", next: steps.travelSaved(placementId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- appointments
const KINDS = ["interview", "medical", "embassy", "orientation", "other"];

export async function addAppointment(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    const kind = field(fd, "kind");
    const when = field(fd, "scheduled_at");
    if (!kind || !KINDS.includes(kind)) return { error: "Choose the type of appointment." };
    if (!when) return { error: "Choose a date and time." };
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return { error: "That date is not valid." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [a] = await tx`
          INSERT INTO appointments (tenant_id, placement_id, kind, scheduled_at, location, notes, created_by)
          VALUES (${ctx.tenantId}, ${placementId}, ${kind}, ${at}, ${field(fd, "location") ?? ""}, ${field(fd, "notes") ?? ""}, ${ctx.userId})
          RETURNING id`;
        await audit(tx, ctx, "appointment.add", "appointment", a.id, { kind });
        if (fd.get("notify") === "on") {
          await notifyCandidate(tx, ctx.tenantId, await candidateOf(tx, placementId), "appointment",
            { kind, when: fmtDateTime(at), where: field(fd, "location") ?? "" });
        }
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Appointment added", next: steps.appointmentAdded(placementId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function setAppointmentResult(id: string, placementId: string, result: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    if (!["pending", "passed", "failed", "no_show", "cancelled"].includes(result)) return { error: "Invalid result." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE appointments SET result = ${result} WHERE id = ${id}`;
        await audit(tx, ctx, "appointment.result", "appointment", id, { result });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Updated" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- contracts
export async function addContract(placementId: string, party: "candidate" | "employer", _: FormState, fd: FormData): Promise<FormState> {
  try {
    let both = false;
    const ctx = await requireCan("pipeline:move");
    const salary = toMinor(field(fd, "salary") ?? "");
    if (salary === null || salary < 0) return { error: "Enter the monthly salary, for example 1300.00." };
    const hours = field(fd, "hours") ? Number(field(fd, "hours")) : null;
    const months = field(fd, "months") ? Number(field(fd, "months")) : null;
    if ((hours !== null && !(hours > 0 && hours <= 100)) || (months !== null && !(months > 0 && months <= 120))) {
      return { error: "Check the hours per week and contract length." };
    }
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [c] = await tx`
          INSERT INTO contracts (tenant_id, placement_id, party, salary_minor, currency, hours_per_week, months, other_terms, signed_on, recorded_by)
          VALUES (${ctx.tenantId}, ${placementId}, ${party}, ${salary}, ${field(fd, "currency") ?? "USD"}, ${hours}, ${months},
                  ${field(fd, "other_terms") ?? ""}, ${field(fd, "signed_on") ?? new Date().toISOString().slice(0, 10)}, ${ctx.userId})
          RETURNING id`;
        await audit(tx, ctx, "contract.record", "contract", c.id, { party });
        const [{ n }] = await tx`SELECT count(DISTINCT party) AS n FROM contracts WHERE placement_id = ${placementId}`;
        both = Number(n) === 2;
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Contract copy recorded", next: steps.contractRecorded(placementId, party, both) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- checklist steps
export async function toggleStep(placementId: string, step: string, done: boolean, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        if (done) {
          await tx`INSERT INTO placement_steps (placement_id, tenant_id, step, done_by) VALUES (${placementId}, ${ctx.tenantId}, ${step}, ${ctx.userId})
                   ON CONFLICT DO NOTHING`;
        } else {
          await tx`DELETE FROM placement_steps WHERE placement_id = ${placementId} AND step = ${step}`;
        }
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: done ? "Done" : "Reopened" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- follow-up check-ins
export async function completeCheckin(id: string, placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    const outcome = field(fd, "outcome");
    if (!outcome || !["well", "concern", "unreachable"].includes(outcome)) return { error: "Choose how the worker is." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE checkins SET done_on = current_date, outcome = ${outcome}, notes = ${field(fd, "notes") ?? ""}, created_by = ${ctx.userId} WHERE id = ${id}`;
        await audit(tx, ctx, "checkin.done", "checkin", id, { outcome });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    revalidatePath("/follow-up");
    return { ok: "Check-in recorded", next: steps.checkinDone() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- complaints
export async function addComplaint(candidateId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("candidates:write");
    const subject = field(fd, "subject");
    const body = field(fd, "body");
    if (!subject || !body) return { error: "Enter a subject and what happened." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [live] = await tx`SELECT id FROM placements WHERE candidate_id = ${candidateId} AND outcome <> 'closed' LIMIT 1`;
        const [c] = await tx`
          INSERT INTO complaints (tenant_id, candidate_id, placement_id, raised_via, subject, body, created_by)
          VALUES (${ctx.tenantId}, ${candidateId}, ${live?.id ?? null}, 'staff', ${subject}, ${body}, ${ctx.userId}) RETURNING id`;
        await audit(tx, ctx, "complaint.add", "complaint", c.id);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/complaints");
    revalidatePath(`/candidates/${candidateId}`);
    return { ok: "Complaint recorded", next: steps.complaintRecorded() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function updateComplaint(id: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("candidates:write");
    const status = field(fd, "status");
    if (!status || !["open", "investigating", "resolved"].includes(status)) return { error: "Choose a status." };
    const resolution = field(fd, "resolution") ?? "";
    if (status === "resolved" && resolution.length < 5) return { error: "Explain how it was resolved." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE complaints SET status = ${status}, resolution = ${resolution},
                 resolved_at = ${status === "resolved" ? new Date() : null} WHERE id = ${id}`;
        await audit(tx, ctx, "complaint.update", "complaint", id, { status });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/complaints");
    return { ok: "Updated" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- employer vetting checks
export async function addEmployerCheck(employerId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("employers:write");
    const kind = field(fd, "kind");
    const result = field(fd, "result");
    if (!kind || !["registration", "references", "past_complaints", "site_visit", "other"].includes(kind)) return { error: "Choose the type of check." };
    if (result !== "ok" && result !== "concern") return { error: "Record whether the check was fine or raised a concern." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [c] = await tx`
          INSERT INTO employer_checks (tenant_id, employer_id, kind, result, notes, checked_by)
          VALUES (${ctx.tenantId}, ${employerId}, ${kind}, ${result}, ${field(fd, "notes") ?? ""}, ${ctx.userId}) RETURNING id`;
        await audit(tx, ctx, "employer.check", "employer", employerId, { kind, result });
        void c;
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/employers/${employerId}`);
    return { ok: "Check recorded", next: steps.employerCheck(employerId, result as "ok" | "concern") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- country checklists (settings)
export async function saveChecklist(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const country = field(fd, "country");
    if (!country) return { error: "Enter the destination country." };
    const split = (v: string | null, sep: RegExp) => (v ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
    const docs = split(field(fd, "docs"), /[,\n]/);
    const stepList = split(field(fd, "steps"), /\n/);
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`
          INSERT INTO country_checklists (tenant_id, country, job_category, required_doc_types, steps, notes)
          VALUES (${ctx.tenantId}, ${country}, ${field(fd, "category") ?? ""}, ${docs}, ${stepList}, ${field(fd, "notes") ?? ""})
          ON CONFLICT (tenant_id, lower(country), lower(job_category))
          DO UPDATE SET required_doc_types = EXCLUDED.required_doc_types, steps = EXCLUDED.steps, notes = EXCLUDED.notes`;
        await audit(tx, ctx, "checklist.save", "checklist", null, { country });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/settings", "layout");
    return { ok: "Checklist saved", next: steps.checklistSaved() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function deleteChecklist(id: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`DELETE FROM country_checklists WHERE id = ${id}`;
        await audit(tx, ctx, "checklist.delete", "checklist", id);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/settings", "layout");
    return { ok: "Deleted" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- applications from the portal
export async function decideApplication(id: string, decision: "shortlisted" | "declined", jobId: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    let pid: string | null = null;
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [a] = await tx`SELECT candidate_id FROM applications WHERE id = ${id} AND status = 'pending'`;
        if (!a) throw new Error("This application has already been dealt with.");
        if (decision === "shortlisted") {
          const [pl] = await tx`SELECT id, job_order_id FROM placements WHERE candidate_id = ${a.candidate_id} AND outcome <> 'closed'`;
          if (!pl) throw new Error("This candidate is not in the pipeline. Re-enter them first.");
          if (pl.job_order_id) throw new Error("This candidate already has a job order assigned.");
          const { assignJob } = await import("@/lib/assign");
          await assignJob(tx, ctx, pl.id, jobId);
          pid = pl.id;
        }
        await tx`UPDATE applications SET status = ${decision} WHERE id = ${id}`;
        await audit(tx, ctx, `application.${decision}`, "application", id);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/job-orders/${jobId}`);
    return { ok: decision === "shortlisted" ? "Shortlisted" : "Declined", next: steps.applicationDecided(pid, decision) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- candidates' data requests
export async function handleDataRequest(id: string, status: "done" | "declined", _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE data_requests SET status = ${status}, note = ${field(fd, "note") ?? ""}, handled_by = ${ctx.userId}, handled_at = now() WHERE id = ${id} AND status = 'open'`;
        await audit(tx, ctx, `data_request.${status}`, "data_request", id);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/complaints");
    return { ok: "Updated" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/**
 * Honours a deletion request. Personal details and documents are removed; the money records the agency must
 * keep for its accounts stay, but no longer point to a named person.
 */
export async function eraseCandidate(candidateId: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const live = await tx`SELECT 1 FROM placements WHERE candidate_id = ${candidateId} AND outcome <> 'closed'`;
        if (live.length) throw new Error("Close this candidate's active placement first.");
        const docs = await tx`SELECT file_key FROM documents WHERE candidate_id = ${candidateId}`;
        await tx`DELETE FROM documents WHERE candidate_id = ${candidateId}`;
        const [c0] = await tx`SELECT phone_norm FROM candidates WHERE id = ${candidateId}`;
        if (c0?.phone_norm) await tx`DELETE FROM otp_codes WHERE phone = ${c0.phone_norm}`;
        await tx`UPDATE mpesa_requests SET phone = 'erased' WHERE candidate_id = ${candidateId}`;
        await tx`SELECT erase_candidate_traces(${candidateId})`;
        await tx`DELETE FROM applications WHERE candidate_id = ${candidateId}`;
        await tx`DELETE FROM complaints WHERE candidate_id = ${candidateId}`;
        await tx`
          UPDATE candidates SET first_name = 'Erased', last_name = 'Candidate', id_number_enc = NULL, id_number_idx = NULL, dob = NULL, gender = NULL,
            phone = '', phone_norm = NULL, email = NULL, county = NULL, skills = '', experience = '', preferred_countries = '', consent_at = NULL, status = 'inactive'
          WHERE id = ${candidateId}`;
        await tx`UPDATE data_requests SET status = 'done', handled_by = ${ctx.userId}, handled_at = now() WHERE candidate_id = ${candidateId} AND kind = 'delete' AND status = 'open'`;
        await audit(tx, ctx, "candidate.erase", "candidate", candidateId, { files: docs.length });
        // File removal is queued so the database change is never held up by storage.
        const { enqueue } = await import("@/lib/queue");
        for (const d of docs) await enqueue(tx, ctx.tenantId, "delete_file", { key: d.file_key });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/complaints");
    revalidatePath("/candidates");
    return { ok: "Erased" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
