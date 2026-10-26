"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCandidate, withTenant } from "@/lib/db";
import { blindIndex, encrypt } from "@/lib/crypto";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { normalizePhone } from "@/lib/phone";
import { issueOtp, checkOtp } from "@/lib/otp";
import { notifyCandidate } from "@/lib/notify";
import { toMinor } from "@/lib/money";
import { assertCandidateSlots, assertFeature } from "@/lib/plan";
import { balanceDue } from "@/lib/pipeline";
import { requestStk } from "@/lib/mpesa-start";
import { checkUpload } from "@/lib/scan";
import { ALLOWED_TYPES, MAX_BYTES, putFile } from "@/lib/storage";
import { DOC_TYPES } from "@/lib/stages";
import {
  createCandidateSession, destroyCandidateSession, requireAgency, requireCandidate,
} from "@/lib/portal-session";

// ---------------------------------------------------------------- sign in and register
const PHONE_COOKIE = "cphone";
const DEV_COOKIE = "cdev";

async function rememberPhone(slug: string, phone: string, mode: "login" | "register", devCode?: string) {
  const jar = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/c" };
  jar.set(PHONE_COOKIE, JSON.stringify({ slug, phone, mode }), opts);
  if (devCode) jar.set(DEV_COOKIE, devCode, opts);
  else jar.delete({ name: DEV_COOKIE, path: "/c" });
}

// Per-address throttle on top of the per-number limit inside issueOtp. Replace with Redis when running several instances.
const hits = new Map<string, { n: number; first: number }>();
function tooMany(key: string, max: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.first > 10 * 60_000) { hits.set(key, { n: 1, first: now }); return false; }
  h.n += 1;
  return h.n > max;
}

export async function requestLoginCode(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const agency = await requireAgency(slug);
    if (!agency.portal_open) return { error: "The candidate portal is closed at the moment. Please call the agency." };
    const phone = normalizePhone(field(fd, "phone") ?? "");
    if (!phone) return { error: "Enter your phone number, for example 0712 345 678." };
    if (tooMany(`login:${slug}`, 40)) return { error: "Too many requests. Please try again later." };

    let dev: string | undefined;
    try {
      await withTenant(agency.id, async (tx) => {
        const [c] = await tx`SELECT id FROM candidates WHERE phone_norm = ${phone} AND status <> 'inactive'`;
        // The answer is the same whether or not the number is registered, so the form cannot be used to find out who is.
        if (!c) return;
        const r = await issueOtp(tx, agency.id, agency.brand_name || agency.name, phone, "login");
        if (!r.ok) throw new Error(r.error);
        dev = r.devCode;
      });
    } catch (e) {
      return fail(e);
    }
    await rememberPhone(slug, phone, "login", dev);
    redirect(`/c/${slug}/verify`);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

const RegisterSchema = z.object({
  first_name: z.string().min(1, "Enter your first name"),
  last_name: z.string().min(1, "Enter your last name"),
  phone: z.string().min(7, "Enter your phone number"),
  id_number: z.string().nullable(),
  county: z.string().nullable(),
  skills: z.string().nullable(),
});

export async function requestRegisterCode(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const agency = await requireAgency(slug);
    if (!agency.portal_open) return { error: "Online registration is closed at the moment. Please visit the agency." };
    const p = RegisterSchema.safeParse({
      first_name: field(fd, "first_name"), last_name: field(fd, "last_name"), phone: field(fd, "phone"),
      id_number: field(fd, "id_number"), county: field(fd, "county"), skills: field(fd, "skills"),
    });
    if (!p.success) return { error: p.error.issues[0].message };
    const phone = normalizePhone(p.data.phone);
    if (!phone) return { error: "Enter a valid phone number, for example 0712 345 678." };
    if (fd.get("consent") !== "on") return { error: "Please agree to the agency keeping your details so it can find you work." };
    if (tooMany(`register:${slug}`, 40)) return { error: "Too many requests. Please try again later." };

    let dev: string | undefined;
    try {
      await withTenant(agency.id, async (tx) => {
        await assertCandidateSlots(tx, agency.id);
        const [exists] = await tx`SELECT 1 FROM candidates WHERE phone_norm = ${phone}`;
        if (exists) throw new Error("This phone number is already registered. Go back and sign in instead.");
        if (p.data.id_number) {
          const [dup] = await tx`SELECT 1 FROM candidates WHERE id_number_idx = ${blindIndex(p.data.id_number)}`;
          if (dup) throw new Error("This ID number is already registered. Go back and sign in with the phone you used before, or contact the agency.");
        }
        const r = await issueOtp(tx, agency.id, agency.brand_name || agency.name, phone, "register", { ...p.data, phone: p.data.phone });
        if (!r.ok) throw new Error(r.error);
        dev = r.devCode;
      });
    } catch (e) {
      return fail(e);
    }
    await rememberPhone(slug, phone, "register", dev);
    redirect(`/c/${slug}/verify`);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function verifyCode(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const agency = await requireAgency(slug);
    const jar = await cookies();
    let saved: { slug: string; phone: string; mode: "login" | "register" } | null = null;
    try { saved = JSON.parse(jar.get(PHONE_COOKIE)?.value ?? "null"); } catch { saved = null; }
    if (!saved || saved.slug !== slug) redirect(`/c/${slug}/login`);
    const code = field(fd, "code") ?? "";
    if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from the SMS." };

    let candidateId: string | null = null;
    try {
      await withTenant(agency.id, async (tx) => {
        const r = await checkOtp(tx, agency.id, saved!.phone, saved!.mode, code);
        if (!r.ok) throw new Error(r.error);
        if (saved!.mode === "login") {
          const [c] = await tx`SELECT id FROM candidates WHERE phone_norm = ${saved!.phone} AND status <> 'inactive'`;
          if (!c) throw new Error("We could not find your record. Contact the agency.");
          candidateId = c.id;
          return;
        }
        // Registration: the details were held with the code, and are saved only now that the phone is proved.
        const d = r.payload as z.infer<typeof RegisterSchema>;
        const [row] = await tx`
          INSERT INTO candidates (tenant_id, first_name, last_name, id_number_enc, id_number_idx, phone, phone_norm, county, skills, consent_at, source)
          VALUES (${agency.id}, ${d.first_name}, ${d.last_name}, ${d.id_number ? encrypt(d.id_number) : null}, ${d.id_number ? blindIndex(d.id_number) : null},
                  ${d.phone}, ${saved!.phone}, ${d.county}, ${d.skills ?? ""}, now(), 'portal')
          RETURNING id`;
        const [stage] = await tx`SELECT id FROM pipeline_stages ORDER BY position LIMIT 1`;
        const [pl] = await tx`INSERT INTO placements (tenant_id, candidate_id, stage_id) VALUES (${agency.id}, ${row.id}, ${stage.id}) RETURNING id`;
        await tx`INSERT INTO stage_history (tenant_id, placement_id, to_stage_id, note) VALUES (${agency.id}, ${pl.id}, ${stage.id}, 'Registered online')`;
        await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id, detail) VALUES (${agency.id}, 'candidate.self_register', 'candidate', ${row.id}, '{}')`;
        await notifyCandidate(tx, agency.id, { id: row.id, name: d.first_name, phone: d.phone, email: null }, "welcome", {});
        candidateId = row.id;
      });
    } catch (e) {
      return fail(e);
    }
    jar.delete({ name: PHONE_COOKIE, path: "/c" });
    jar.delete({ name: DEV_COOKIE, path: "/c" });
    await createCandidateSession(candidateId!, agency.id);
    redirect(saved!.mode === "register" ? `/c/${slug}/home?next=portal_welcome` : `/c/${slug}/home`);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function candidateLogout(slug: string) {
  await destroyCandidateSession();
  redirect(`/c/${slug}/login`);
}

// ---------------------------------------------------------------- signed-in actions
const refresh = (slug: string) => revalidatePath(`/c/${slug}`, "layout");

export async function portalUpload(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { agency, me } = await requireCandidate(slug);
    const file = fd.get("file");
    const type = field(fd, "doc_type");
    if (!type || !DOC_TYPES.includes(type)) return { error: "Choose the type of document." };
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
    if (!ALLOWED_TYPES.includes(file.type)) return { error: "Only PDF, JPG or PNG files are accepted." };
    if (file.size > MAX_BYTES) return { error: "The file is larger than 8 MB. Take a smaller photo or scan." };
    const bytes = Buffer.from(await file.arrayBuffer());
    const refused = await checkUpload(bytes, file.type);
    if (refused) return { error: refused };
    try {
      const key = await putFile(agency.id, bytes, file.type);
      await withCandidate(agency.id, me.candidateId, async (tx) => {
        const [d] = await tx`
          INSERT INTO documents (tenant_id, candidate_id, doc_type, doc_number_enc, issue_date, expiry_date, file_key, file_name, mime_type)
          VALUES (${agency.id}, ${me.candidateId}, ${type}, ${field(fd, "doc_number") ? encrypt(field(fd, "doc_number")!) : null},
                  ${field(fd, "issue_date")}, ${field(fd, "expiry_date")}, ${key}, ${file.name}, ${file.type}) RETURNING id`;
        await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id, detail) VALUES (${agency.id}, 'document.portal_upload', 'document', ${d.id}, ${tx.json({ type } as never)})`;
      });
    } catch (e) {
      return fail(e);
    }
    refresh(slug);
    return { ok: "Uploaded. The agency will check it and let you know.", next: steps.portalDocument(slug) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function applyToJob(slug: string, jobId: string, _: FormState): Promise<FormState> {
  try {
    const { agency, me } = await requireCandidate(slug);
    try {
      await withCandidate(agency.id, me.candidateId, async (tx) => {
        const [j] = await tx`SELECT id FROM job_orders WHERE id = ${jobId} AND status = 'open'`;
        if (!j) throw new Error("That job is no longer open.");
        await tx`INSERT INTO applications (tenant_id, candidate_id, job_order_id) VALUES (${agency.id}, ${me.candidateId}, ${jobId}) ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id) VALUES (${agency.id}, 'application.create', 'job_order', ${jobId})`;
      });
    } catch (e) {
      return fail(e);
    }
    refresh(slug);
    return { ok: "Application sent", next: steps.portalApplied(slug) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function withdrawApplication(slug: string, jobId: string, _: FormState): Promise<FormState> {
  try {
    const { agency, me } = await requireCandidate(slug);
    try {
      await withCandidate(agency.id, me.candidateId, (tx) =>
        tx`UPDATE applications SET status = 'withdrawn' WHERE job_order_id = ${jobId} AND candidate_id = ${me.candidateId} AND status = 'pending'`);
    } catch (e) {
      return fail(e);
    }
    refresh(slug);
    return { ok: "Application withdrawn", next: steps.portalWithdrawn(slug) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function portalComplaint(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { agency, me } = await requireCandidate(slug);
    const subject = field(fd, "subject");
    const body = field(fd, "body");
    if (!subject || !body || body.length < 10) return { error: "Tell us what happened, in a few sentences." };
    try {
      await withCandidate(agency.id, me.candidateId, async (tx) => {
        const [live] = await tx`SELECT id FROM placements WHERE outcome <> 'closed' ORDER BY created_at DESC LIMIT 1`;
        const [c] = await tx`
          INSERT INTO complaints (tenant_id, candidate_id, placement_id, raised_via, subject, body)
          VALUES (${agency.id}, ${me.candidateId}, ${live?.id ?? null}, 'portal', ${subject}, ${body}) RETURNING id`;
        await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id) VALUES (${agency.id}, 'complaint.portal', 'complaint', ${c.id})`;
        await notifyCandidate(tx, agency.id, { id: me.candidateId, name: me.name.split(" ")[0], phone: me.phone, email: me.email }, "complaint_received", {});
      });
    } catch (e) {
      return fail(e);
    }
    refresh(slug);
    return { ok: "We received your complaint. You can follow its progress on the Help page.", next: steps.portalComplaint(slug) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function portalProfile(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { agency, me } = await requireCandidate(slug);
    const email = field(fd, "email");
    if (email && !z.email().safeParse(email).success) return { error: "Enter a valid email address." };
    try {
      await withCandidate(agency.id, me.candidateId, async (tx) => {
        await tx`
          UPDATE candidates SET email = ${email}, county = ${field(fd, "county")}, skills = ${field(fd, "skills") ?? ""},
            experience = ${field(fd, "experience") ?? ""}, preferred_countries = ${field(fd, "preferred_countries") ?? ""} WHERE id = ${me.candidateId}`;
        await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id) VALUES (${agency.id}, 'candidate.portal_update', 'candidate', ${me.candidateId})`;
      });
    } catch (e) {
      return fail(e);
    }
    refresh(slug);
    return { ok: "Saved", next: steps.portalProfileSaved(slug) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Pays an agency fee from the candidate's own phone with M-Pesa. */
export async function portalPay(slug: string, placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const { agency, me } = await requireCandidate(slug);
    const phone = normalizePhone(field(fd, "phone") ?? "");
    if (!phone || !phone.startsWith("+254")) return { error: "Enter your Safaricom number, for example 0712 345 678." };
    const minor = toMinor(field(fd, "amount") ?? "");
    if (minor === null || minor < 100 || minor % 100 !== 0) return { error: "Enter a whole amount in shillings, for example 2500." };
    try {
      await assertFeature(agency.id, "mpesa", "Online payment");
      await withCandidate(agency.id, me.candidateId, async (tx) => {
        const [own] = await tx`SELECT id FROM placements WHERE id = ${placementId} AND outcome <> 'closed'`;
        if (!own) throw new Error("Nothing to pay for.");
        const due = await balanceDue(tx, placementId);
        if (due <= 0) throw new Error("You have nothing due right now.");
        if (minor > due) throw new Error(`You only owe KES ${(due / 100).toLocaleString("en-KE")} right now.`);
        await requestStk(tx, { tenantId: agency.id, placementId, candidateId: me.candidateId, phone, amountMinor: minor, createdBy: null });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(slug);
    return { ok: "Check your phone and enter your M-Pesa PIN. This page will show your receipt once it is confirmed.", next: steps.portalPay(slug) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function requestData(slug: string, kind: "export" | "delete", _: FormState): Promise<FormState> {
  try {
    const { agency, me } = await requireCandidate(slug);
    try {
      await withCandidate(agency.id, me.candidateId, async (tx) => {
        const [open] = await tx`SELECT 1 FROM data_requests WHERE kind = ${kind} AND status = 'open'`;
        if (open) throw new Error("You already have an open request. The agency will contact you.");
        await tx`INSERT INTO data_requests (tenant_id, candidate_id, kind) VALUES (${agency.id}, ${me.candidateId}, ${kind})`;
        await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id) VALUES (${agency.id}, ${"data_request." + kind}, 'candidate', ${me.candidateId})`;
      });
    } catch (e) {
      return fail(e);
    }
    refresh(slug);
    return { ok: kind === "delete" ? "Your request to delete your data was sent to the agency." : "Your request was sent. You can also download your data now.", next: steps.portalRequestSent(slug) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

