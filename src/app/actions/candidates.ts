"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { requireCan } from "@/lib/session";
import { audit } from "@/lib/audit";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { ALLOWED_TYPES, MAX_BYTES, putFile } from "@/lib/storage";
import { checkUpload } from "@/lib/scan";
import { blindIndex, encrypt } from "@/lib/crypto";
import { normalizePhone } from "@/lib/phone";

const sealId = (v: string | null) => (v ? { enc: encrypt(v.trim()), idx: blindIndex(v) } : { enc: null, idx: null });
import { notifyCandidate } from "@/lib/notify";
import { assertCandidateSlots } from "@/lib/plan";

const CandidateSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  phone: z.string().min(7, "Enter a phone number"),
  id_number: z.string().nullable(),
  email: z.email("Enter a valid email").nullable(),
  dob: z.string().nullable(),
  gender: z.string().nullable(),
  county: z.string().nullable(),
  skills: z.string().nullable(),
  experience: z.string().nullable(),
  experience_years: z.coerce.number().int().min(0, "Years of experience cannot be negative").max(60, "Check the years of experience").nullable(),
  preferred_countries: z.string().nullable(),
});

function parse(fd: FormData) {
  return CandidateSchema.safeParse({
    first_name: field(fd, "first_name"),
    last_name: field(fd, "last_name"),
    phone: field(fd, "phone"),
    id_number: field(fd, "id_number"),
    email: field(fd, "email"),
    dob: field(fd, "dob"),
    gender: field(fd, "gender"),
    county: field(fd, "county"),
    skills: field(fd, "skills"),
    experience: field(fd, "experience"),
    experience_years: field(fd, "experience_years"),
    preferred_countries: field(fd, "preferred_countries"),
  });
}

export async function createCandidate(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("candidates:write");
    const p = parse(fd);
    if (!p.success) return { error: p.error.issues[0].message };
    if (fd.get("consent") !== "on") return { error: "Record the candidate's consent to store their data." };
    const c = p.data;
    const phoneNorm = normalizePhone(c.phone);
    if (!phoneNorm) return { error: "Enter a valid phone number, for example 0712 345 678." };

    let id: string;
    try {
      id = await withTenant(ctx.tenantId, async (tx) => {
        if (c.id_number) {
          const dup = await tx`SELECT id, first_name, last_name FROM candidates WHERE id_number_idx = ${blindIndex(c.id_number)}`;
          if (dup[0]) throw new Error(`Already registered: ${dup[0].first_name} ${dup[0].last_name} has this ID number.`);
        }
        await assertCandidateSlots(tx, ctx.tenantId);
        const dupPhone = await tx`SELECT first_name, last_name FROM candidates WHERE phone_norm = ${phoneNorm}`;
        if (dupPhone[0]) throw new Error(`Already registered: ${dupPhone[0].first_name} ${dupPhone[0].last_name} has this phone number.`);
        const [row] = await tx`
          INSERT INTO candidates (tenant_id, first_name, last_name, id_number_enc, id_number_idx, dob, gender, phone, phone_norm, email, county,
                                  skills, experience, experience_years, preferred_countries, consent_at, created_by)
          VALUES (${ctx.tenantId}, ${c.first_name}, ${c.last_name}, ${sealId(c.id_number).enc}, ${sealId(c.id_number).idx}, ${c.dob}, ${c.gender}, ${c.phone}, ${phoneNorm},
                  ${c.email}, ${c.county}, ${c.skills ?? ""}, ${c.experience ?? ""}, ${c.experience_years}, ${c.preferred_countries ?? ""},
                  now(), ${ctx.userId})
          RETURNING id`;
        // Every candidate starts in the pipeline at the first stage.
        const [stage] = await tx`SELECT id FROM pipeline_stages ORDER BY position LIMIT 1`;
        const [pl] = await tx`
          INSERT INTO placements (tenant_id, candidate_id, stage_id) VALUES (${ctx.tenantId}, ${row.id}, ${stage.id})
          RETURNING id`;
        await tx`
          INSERT INTO stage_history (tenant_id, placement_id, to_stage_id, user_id, note)
          VALUES (${ctx.tenantId}, ${pl.id}, ${stage.id}, ${ctx.userId}, 'Registered')`;
        await audit(tx, ctx, "candidate.create", "candidate", row.id, { name: `${c.first_name} ${c.last_name}` });
        await notifyCandidate(tx, ctx.tenantId, { id: row.id, name: c.first_name, phone: c.phone, email: c.email }, "welcome", {});
        return row.id as string;
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/candidates");
    redirect(`/candidates/${id}?next=candidate_created&ref=${id}`);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function updateCandidate(id: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("candidates:write");
    const p = parse(fd);
    if (!p.success) return { error: p.error.issues[0].message };
    const c = p.data;
    const phoneNorm = normalizePhone(c.phone);
    if (!phoneNorm) return { error: "Enter a valid phone number, for example 0712 345 678." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const dupPhone = await tx`SELECT first_name, last_name FROM candidates WHERE phone_norm = ${phoneNorm} AND id <> ${id}`;
        if (dupPhone[0]) throw new Error(`${dupPhone[0].first_name} ${dupPhone[0].last_name} already has this phone number.`);
        await tx`
          UPDATE candidates SET first_name = ${c.first_name}, last_name = ${c.last_name}, id_number_enc = ${sealId(c.id_number).enc}, id_number_idx = ${sealId(c.id_number).idx},
            dob = ${c.dob}, gender = ${c.gender}, phone = ${c.phone}, phone_norm = ${phoneNorm}, email = ${c.email}, county = ${c.county},
            skills = ${c.skills ?? ""}, experience = ${c.experience ?? ""}, experience_years = ${c.experience_years}, preferred_countries = ${c.preferred_countries ?? ""}
          WHERE id = ${id}`;
        await audit(tx, ctx, "candidate.update", "candidate", id);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/candidates/${id}`);
    return { ok: "Saved", next: steps.candidateSaved(id) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function uploadDocument(candidateId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("documents:write");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
    if (!ALLOWED_TYPES.includes(file.type)) return { error: "Only PDF, JPG or PNG files are accepted." };
    if (file.size > MAX_BYTES) return { error: "The file is larger than 8 MB." };
    const docType = field(fd, "doc_type");
    if (!docType) return { error: "Choose the document type." };

    const bytes = Buffer.from(await file.arrayBuffer());
    const refused = await checkUpload(bytes, file.type);
    if (refused) return { error: refused };

    try {
      const key = await putFile(ctx.tenantId, bytes, file.type);
      await withTenant(ctx.tenantId, async (tx) => {
        const [d] = await tx`
          INSERT INTO documents (tenant_id, candidate_id, doc_type, doc_number_enc, issue_date, expiry_date, file_key, file_name, mime_type)
          VALUES (${ctx.tenantId}, ${candidateId}, ${docType}, ${field(fd, "doc_number") ? encrypt(field(fd, "doc_number")!) : null}, ${field(fd, "issue_date")},
                  ${field(fd, "expiry_date")}, ${key}, ${file.name}, ${file.type})
          RETURNING id`;
        await audit(tx, ctx, "document.upload", "document", d.id, { type: docType });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/candidates/${candidateId}`);
    return { ok: "Uploaded", next: steps.documentUploaded(candidateId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function reviewDocument(docId: string, candidateId: string, status: "verified" | "rejected", _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("documents:verify");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`
          UPDATE documents SET status = ${status}, verified_by = ${ctx.userId}, verified_at = now() WHERE id = ${docId}`;
        await audit(tx, ctx, `document.${status}`, "document", docId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/verify");
    return { ok: status === "verified" ? "Verified" : "Rejected", next: steps.documentReviewed(candidateId, status) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

const IMPORT_MAX_ROWS = 500;

/** Bulk import from a CSV (pasted or uploaded). Each row becomes a candidate at the first pipeline stage. */
export async function importCandidates(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("candidates:write");
    if (fd.get("consent") !== "on") return { error: "Confirm that each person in this file agreed to the agency storing their data." };

    let text = field(fd, "csv") ?? "";
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 2 * 1024 * 1024) return { error: "The file is larger than 2 MB." };
      text = await file.text();
    }
    if (!text.trim()) return { error: "Paste CSV text or choose a file." };

    const { parseCsv } = await import("@/lib/csv");
    const rows = parseCsv(text);
    const header = rows.shift()?.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")) ?? [];
    for (const need of ["first_name", "last_name", "phone"]) {
      if (!header.includes(need)) return { error: `The first row must be a header including: first_name, last_name, phone. Missing: ${need}.` };
    }
    if (rows.length === 0) return { error: "There are no candidate rows under the header." };
    if (rows.length > IMPORT_MAX_ROWS) return { error: `Import at most ${IMPORT_MAX_ROWS} rows at a time.` };

    const get = (r: string[], name: string) => {
      const i = header.indexOf(name);
      const v = i >= 0 ? (r[i] ?? "").trim() : "";
      return v === "" ? null : v;
    };

    const skipped: string[] = [];
    let created = 0;
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await assertCandidateSlots(tx, ctx.tenantId, rows.length);
        const [stage] = await tx`SELECT id FROM pipeline_stages ORDER BY position LIMIT 1`;
        const seenIds = new Set<string>();
        const seenPhones = new Set<string>();
        for (const [n, r] of rows.entries()) {
          const line = n + 2; // header is line 1
          const first = get(r, "first_name"), last = get(r, "last_name"), phone = get(r, "phone");
          const idn = get(r, "id_number"), email = get(r, "email");
          if (!first || !last || !phone) { skipped.push(`line ${line}: name and phone are required`); continue; }
          if (email && !z.email().safeParse(email).success) { skipped.push(`line ${line}: invalid email`); continue; }
          const pn = normalizePhone(phone);
          if (!pn) { skipped.push(`line ${line}: phone number is not valid`); continue; }
          if (seenPhones.has(pn)) { skipped.push(`line ${line}: phone ${phone} appears twice in the file`); continue; }
          seenPhones.add(pn);
          if ((await tx`SELECT 1 FROM candidates WHERE phone_norm = ${pn}`).length) { skipped.push(`line ${line}: phone ${phone} is already registered`); continue; }
          if (idn) {
            if (seenIds.has(idn)) { skipped.push(`line ${line}: ID ${idn} appears twice in the file`); continue; }
            seenIds.add(idn);
            const dup = await tx`SELECT 1 FROM candidates WHERE id_number_idx = ${blindIndex(idn)}`;
            if (dup.length) { skipped.push(`line ${line}: ID ${idn} is already registered`); continue; }
          }
          const [c] = await tx`
            INSERT INTO candidates (tenant_id, first_name, last_name, id_number_enc, id_number_idx, gender, phone, phone_norm, source, email, county, skills, consent_at, created_by)
            VALUES (${ctx.tenantId}, ${first}, ${last}, ${sealId(idn).enc}, ${sealId(idn).idx}, ${get(r, "gender")}, ${phone}, ${pn}, 'import', ${email}, ${get(r, "county")},
                    ${get(r, "skills") ?? ""}, now(), ${ctx.userId})
            RETURNING id`;
          const [pl] = await tx`
            INSERT INTO placements (tenant_id, candidate_id, stage_id) VALUES (${ctx.tenantId}, ${c.id}, ${stage.id}) RETURNING id`;
          await tx`
            INSERT INTO stage_history (tenant_id, placement_id, to_stage_id, user_id, note)
            VALUES (${ctx.tenantId}, ${pl.id}, ${stage.id}, ${ctx.userId}, 'Imported')`;
          created++;
          if (fd.get("welcome") === "on") {
            await notifyCandidate(tx, ctx.tenantId, { id: c.id, name: first, phone, email }, "welcome", {});
          }
        }
        await audit(tx, ctx, "candidate.import", "candidate", null, { created, skipped: skipped.length });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/candidates");
    const tail = skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 8).join("; ")}${skipped.length > 8 ? "…" : ""}` : "";
    if (created === 0) return { error: `Nothing was imported.${tail}` };
    return { ok: `Imported ${created} candidate${created === 1 ? "" : "s"}.${tail}`, next: steps.importDone(created) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
