"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCan } from "@/lib/session";
import { audit, nextNumber } from "@/lib/audit";
import { blindIndex, encrypt } from "@/lib/crypto";
import { fail, type FormState } from "@/lib/form";
import { steps } from "@/lib/next-steps";

const PEOPLE: [string, string, string, string, number, number | null][] = [
  // first, last, county, skills, stage position, job index
  ["Amina", "Wanjiru", "Nairobi", "Housekeeping, cooking", 1, null],
  ["Brian", "Otieno", "Kisumu", "Driving, customer service", 1, null],
  ["Caroline", "Mutua", "Machakos", "Nursing, first aid", 1, null],
  ["David", "Kiptoo", "Eldoret", "Housekeeping, laundry", 2, 0],
  ["Esther", "Njeri", "Nakuru", "Registered nurse, 6 years", 2, 1],
  ["Felix", "Mwangi", "Nairobi", "Registered nurse, ICU", 3, 1],
  ["Grace", "Achieng", "Kisumu", "Housekeeping, supervision", 4, 0],
  ["Hassan", "Abdi", "Mombasa", "Electrician, site work", 2, 2],
  ["Irene", "Chebet", "Kericho", "Registered nurse, theatre", 1, null],
  ["John", "Kamau", "Thika", "Housekeeping, front desk", 5, 0],
];

/** Fills the workspace with a small, realistic set of records so every screen has something to show. */
export async function loadSampleData(_: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    await withTenant(ctx.tenantId, async (tx) => {
      const [{ n }] = await tx`SELECT count(*) AS n FROM candidates WHERE source = 'sample'`;
      if (Number(n) > 0) throw new Error("Sample data is already loaded.");
      const stage = async (pos: number) => (await tx`SELECT id FROM pipeline_stages WHERE position = ${pos}`)[0].id as string;
      const T = ctx.tenantId;

      const emp = await tx`
        INSERT INTO employers (tenant_id, company, country, contact_name, email, currency, vetted, is_sample) VALUES
          (${T}, 'Al Noor Hospitality (sample)', 'United Arab Emirates', 'Omar Al Noor', 'hr@alnoor.example', 'AED', true, true),
          (${T}, 'Gulf Care Services (sample)', 'Qatar', 'Layla Hassan', 'jobs@gulfcare.example', 'USD', true, true),
          (${T}, 'Riyadh Build Co (sample)', 'Saudi Arabia', 'Khalid Saeed', 'hr@riyadhbuild.example', 'SAR', false, true)
        RETURNING id`;
      for (const e of emp.slice(0, 2)) {
        await tx`INSERT INTO employer_checks (tenant_id, employer_id, kind, result, notes, checked_by) VALUES
          (${T}, ${e.id}, 'registration', 'ok', 'Trade licence checked (sample)', ${ctx.userId}), (${T}, ${e.id}, 'references', 'ok', 'Two agency references (sample)', ${ctx.userId})`;
      }
      const jobs = await tx`
        INSERT INTO job_orders (tenant_id, employer_id, title, country, category, quantity, salary, deadline, payment_model, placement_fee_minor, fee_currency, is_sample) VALUES
          (${T}, ${emp[0].id}, 'Hotel housekeeper', 'United Arab Emirates', 'Hospitality', 10, 'AED 1,300 / month', current_date + 45, 'employer_paid', 60000, 'USD', true),
          (${T}, ${emp[1].id}, 'Registered nurse', 'Qatar', 'Nursing', 4, 'USD 1,100 / month', current_date + 60, 'employer_paid', 150000, 'USD', true),
          (${T}, ${emp[2].id}, 'Site electrician', 'Saudi Arabia', 'Construction', 6, 'SAR 2,200 / month', current_date + 30, 'candidate_paid', 0, 'USD', true)
        RETURNING id, payment_model`;

      let i = 0;
      for (const [first, last, county, skills, pos, jobIdx] of PEOPLE) {
        i++;
        const idn = `SAMPLE-${String(i).padStart(4, "0")}`;
        const phone = `+2547000000${String(i).padStart(2, "0")}`;
        const [c] = await tx`
          INSERT INTO candidates (tenant_id, first_name, last_name, id_number_enc, id_number_idx, phone, phone_norm, county, skills, consent_at, source, created_by)
          VALUES (${T}, ${first}, ${last}, ${encrypt(idn)}, ${blindIndex(idn)}, ${phone}, ${phone}, ${county}, ${skills}, now(), 'sample', ${ctx.userId}) RETURNING id`;
        const job = jobIdx === null ? null : jobs[jobIdx];
        const [p] = await tx`
          INSERT INTO placements (tenant_id, candidate_id, job_order_id, stage_id, payment_model, outcome)
          VALUES (${T}, ${c.id}, ${job?.id ?? null}, ${await stage(pos)}, ${job?.payment_model ?? null}, ${pos >= 5 ? "deployed" : "active"}) RETURNING id`;
        await tx`INSERT INTO stage_history (tenant_id, placement_id, to_stage_id, user_id, note) VALUES (${T}, ${p.id}, ${await stage(pos)}, ${ctx.userId}, 'Sample record')`;
        if (pos >= 5) await tx`UPDATE candidates SET status = 'placed' WHERE id = ${c.id}`;

        // Documents: verified for people who are further along, waiting for the rest
        const verified = pos >= 3;
        for (const [type, days] of [["Passport", i === 3 ? 40 : 900], ["National ID", null]] as [string, number | null][]) {
          await tx`
            INSERT INTO documents (tenant_id, candidate_id, doc_type, doc_number_enc, expiry_date, file_key, file_name, mime_type, status, verified_by, verified_at)
            VALUES (${T}, ${c.id}, ${type}, ${encrypt(`${type.slice(0, 1)}${idn}`)}, ${days === null ? null : tx`current_date + ${days}::int`}, 'seed/none', ${type.toLowerCase().replace(" ", "-") + ".pdf"},
                    'application/pdf', ${verified ? "verified" : "pending"}, ${verified ? ctx.userId : null}, ${verified ? tx`now()` : null})`;
        }
        if (pos >= 4) {
          for (const type of ["Police clearance", "Medical report"]) {
            await tx`
              INSERT INTO documents (tenant_id, candidate_id, doc_type, expiry_date, file_key, file_name, mime_type, status, verified_by, verified_at)
              VALUES (${T}, ${c.id}, ${type}, current_date + 300, 'seed/none', ${type.toLowerCase().replace(" ", "-") + ".pdf"}, 'application/pdf', 'verified', ${ctx.userId}, now())`;
          }
        }
        // Money
        if (job?.payment_model === "employer_paid" && pos >= 3) {
          await tx`INSERT INTO costs (tenant_id, placement_id, category, amount_minor, payee, incurred_on, receipt_ref, created_by) VALUES
            (${T}, ${p.id}, 'Passport', 450000, 'Immigration (sample)', current_date - 12, 'R-1042', ${ctx.userId}),
            (${T}, ${p.id}, 'Medical', 850000, 'Afya Clinic (sample)', current_date - 6, 'R-1077', ${ctx.userId})`;
        }
        if (job?.payment_model === "candidate_paid") {
          await tx`INSERT INTO fee_charges (tenant_id, placement_id, fee_type, amount_minor, due_on, created_by) VALUES
            (${T}, ${p.id}, 'Registration', 500000, current_date - 3, ${ctx.userId}), (${T}, ${p.id}, 'Medical', 900000, current_date + 20, ${ctx.userId})`;
          const receipt = await nextNumber(tx, T, "receipt", "RCT");
          await tx`INSERT INTO payments (tenant_id, receipt_no, party, placement_id, method, amount_minor, currency, reference, created_by)
                   VALUES (${T}, ${receipt}, 'candidate', ${p.id}, 'mpesa', 200000, 'KES', 'SAMPLE001', ${ctx.userId})`;
        }
        if (pos === 2 && i === 5) {
          await tx`INSERT INTO appointments (tenant_id, placement_id, kind, scheduled_at, location, created_by)
                   VALUES (${T}, ${p.id}, 'interview', now() + interval '2 days', 'Video call (sample)', ${ctx.userId})`;
        }
        if (pos === 3) {
          await tx`INSERT INTO contracts (tenant_id, placement_id, party, salary_minor, currency, hours_per_week, months, recorded_by) VALUES
            (${T}, ${p.id}, 'candidate', 110000, 'USD', 48, 24, ${ctx.userId}), (${T}, ${p.id}, 'employer', 110000, 'USD', 48, 24, ${ctx.userId})`;
        }
        if (pos === 5) {
          await tx`INSERT INTO placement_travel (placement_id, tenant_id, visa_status, visa_number, visa_expiry, departure_on, orientation_done_on, arrival_confirmed_on, employer_start_on)
                   VALUES (${p.id}, ${T}, 'approved', 'SAMPLE-VISA', current_date + 700, current_date - 40, current_date - 45, current_date - 39, current_date - 38)`;
          for (const days of [30, 90, 180]) await tx`INSERT INTO checkins (tenant_id, placement_id, due_on) VALUES (${T}, ${p.id}, current_date + ${days - 40}::int)`;
        }
      }
      // An online application waiting to be reviewed, and an open complaint to answer
      const [irene] = await tx`SELECT id FROM candidates WHERE first_name = 'Irene' AND source = 'sample'`;
      await tx`INSERT INTO applications (tenant_id, candidate_id, job_order_id) VALUES (${T}, ${irene.id}, ${jobs[1].id})`;
      const [grace] = await tx`SELECT c.id, p.id AS pid FROM candidates c JOIN placements p ON p.candidate_id = c.id WHERE c.first_name = 'Grace' AND c.source = 'sample'`;
      await tx`INSERT INTO complaints (tenant_id, candidate_id, placement_id, raised_via, subject, body)
               VALUES (${T}, ${grace.id}, ${grace.pid}, 'staff', 'Asked about the medical cost', 'Sample: the candidate asked why the medical was charged to them and wants it explained.')`;
      await audit(tx, ctx, "sample.load", "tenant", T, { candidates: PEOPLE.length });
    });
    revalidatePath("/", "layout");
    return { ok: "Sample data loaded", next: steps.sampleLoaded() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function removeSampleData(_: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const out = await withTenant(ctx.tenantId, async (tx) => (await tx`SELECT sample_remove() AS r`)[0].r as { candidates: number; employers: number; jobs: number });
    revalidatePath("/", "layout");
    return {
      ok: `Removed ${out.candidates} sample candidates, ${out.employers} employers and ${out.jobs} job orders.`,
      next: { title: "Sample data removed", body: "Your workspace is clean. A good place to start is adding your own employer or importing your candidates.", actions: [
        { label: "Import my candidates", href: "/candidates/import", primary: true }, { label: "Add an employer", href: "/employers/new" }, { label: "Back to the dashboard", href: "/" } ] },
    };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
