import { config } from "dotenv";
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { DEFAULT_STAGES } from "../src/lib/stages";
import { blindIndex, encrypt } from "../src/lib/crypto";
import { normalizePhone } from "../src/lib/phone";

config({ path: ".env.local" });

// Dev data only. Connects as the table owner so it can create tenants directly.
const sql = postgres(process.env.MIGRATE_DATABASE_URL!, { onnotice: () => {} });
const PASSWORD = "Password123!";

async function createTenant(name: string, slug: string, domain: string) {
  const [t] = await sql`INSERT INTO tenants (name, slug) VALUES (${name}, ${slug}) RETURNING id`;
  const hash = await bcrypt.hash(PASSWORD, 10);
  const users: [string, string, string][] = [
    ["Admin User", `admin@${domain}`, "admin"],
    ["Rachel Recruiter", `recruiter@${domain}`, "recruiter"],
    ["Daniel Docs", `docs@${domain}`, "documentation"],
    ["Faith Finance", `finance@${domain}`, "finance"],
  ];
  const ids: Record<string, string> = {};
  for (const [n, email, role] of users) {
    const [u] = await sql`
      INSERT INTO users (tenant_id, name, email, password_hash, role)
      VALUES (${t.id}, ${n}, ${email}, ${hash}, ${role}) RETURNING id`;
    ids[role] = u.id;
  }
  const stageIds: string[] = [];
  for (const [i, s] of DEFAULT_STAGES.entries()) {
    const [r] = await sql`
      INSERT INTO pipeline_stages
        (tenant_id, position, name, description, required_doc_types, requires_payment,
         requires_job_order, requires_vetted_employer, marks_deployed,
         requires_contract, requires_visa, requires_orientation, requires_arrival)
      VALUES (${t.id}, ${i + 1}, ${s.name}, ${s.description}, ${s.requiredDocTypes}, ${s.requiresPayment},
              ${s.requiresJobOrder}, ${s.requiresVettedEmployer}, ${s.marksDeployed},
              ${s.requiresContract}, ${s.requiresVisa}, ${s.requiresOrientation}, ${s.requiresArrival})
      RETURNING id`;
    stageIds.push(r.id);
  }
  return { tenantId: t.id as string, ids, stageIds };
}

/** Safe to run again: adds anything the demo agency is still missing. */
async function extras() {
  const [t] = await sql`SELECT id FROM tenants WHERE slug = 'demo'`;
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [admin] = await sql`SELECT id FROM users WHERE email = 'admin@demo.test'`;
  const emps = await sql`SELECT id, company FROM employers WHERE tenant_id = ${t.id}`;
  for (const e of emps) {
    const slug = e.company.toLowerCase().includes("al noor") ? "alnoor" : e.company.toLowerCase().includes("gulf") ? "gulfcare" : null;
    if (e.vetted !== false) {
      const has = await sql`SELECT 1 FROM employer_checks WHERE employer_id = ${e.id}`;
      const [emp] = await sql`SELECT vetted FROM employers WHERE id = ${e.id}`;
      if (!has.length && emp.vetted) {
        await sql`INSERT INTO employer_checks (tenant_id, employer_id, kind, result, notes, checked_by) VALUES
          (${t.id}, ${e.id}, 'registration', 'ok', 'Trade licence checked', ${admin.id}), (${t.id}, ${e.id}, 'references', 'ok', 'Two agency references', ${admin.id})`;
      }
    }
    if (slug) {
      await sql`INSERT INTO users (tenant_id, name, email, password_hash, role, employer_id)
                VALUES (${t.id}, ${e.company + " HR"}, ${`employer@${slug}.test`}, ${hash}, 'employer', ${e.id}) ON CONFLICT DO NOTHING`;
    }
  }
  await sql`INSERT INTO country_checklists (tenant_id, country, job_category, required_doc_types, steps)
            VALUES (${t.id}, 'United Arab Emirates', '', ${["Passport", "Police clearance", "Medical report"]}, ${["Attend pre-departure briefing", "Collect employment contract"]})
            ON CONFLICT DO NOTHING`;
  const [hasPlatform] = await sql`SELECT count(*) AS n FROM platform_admins`;
  if (Number(hasPlatform.n) === 0) {
    await sql`INSERT INTO platform_admins (email, name, password_hash) VALUES ('platform@demo.test', 'Platform Owner', ${await bcrypt.hash("PlatformDemo123!", 11)})`;
    console.log("Platform console: /platform/login as platform@demo.test / PlatformDemo123!");
  }
  console.log("Demo extras ready: employer@alnoor.test and employer@gulfcare.test (same password), candidate portal at /c/demo");
}

async function main() {
  const existing = await sql`SELECT 1 FROM tenants WHERE slug = 'demo'`;
  if (existing.length) {
    console.log("Seed data already present.");
    await extras();
    await sql.end();
    return;
  }

  const demo = await createTenant("Demo Recruitment Agency", "demo", "demo.test");
  await createTenant("Other Agency Ltd", "other", "other.test"); // a second agency, to prove isolation
  const T = demo.tenantId;

  const employers = await sql`
    INSERT INTO employers (tenant_id, company, country, contact_name, email, currency, vetted) VALUES
      (${T}, 'Al Noor Hospitality', 'United Arab Emirates', 'Omar Al Noor', 'hr@alnoor.example', 'AED', true),
      (${T}, 'Gulf Care Services', 'Qatar', 'Layla Hassan', 'jobs@gulfcare.example', 'USD', true),
      (${T}, 'Riyadh Build Co', 'Saudi Arabia', 'Khalid Saeed', 'hr@riyadhbuild.example', 'SAR', false)
    RETURNING id`;

  const jobs = await sql`
    INSERT INTO job_orders (tenant_id, employer_id, title, country, quantity, salary, deadline, payment_model, placement_fee_minor, fee_currency) VALUES
      (${T}, ${employers[0].id}, 'Hotel housekeeper', 'United Arab Emirates', 10, 'AED 1,300 / month', current_date + 45, 'employer_paid', 90000, 'USD'),
      (${T}, ${employers[1].id}, 'Registered nurse', 'Qatar', 4, 'USD 1,100 / month', current_date + 60, 'employer_paid', 150000, 'USD'),
      (${T}, ${employers[2].id}, 'Site electrician', 'Saudi Arabia', 6, 'SAR 2,200 / month', current_date + 30, 'candidate_paid', 0, 'USD')
    RETURNING id, payment_model`;

  const people = [
    ["Amina", "Wanjiru", "29104455", "0712345001", "Nairobi", 0, null],
    ["Brian", "Otieno", "30118822", "0723456002", "Kisumu", 0, null],
    ["Caroline", "Mutua", "27665544", "0734567003", "Machakos", 1, 0],
    ["David", "Kiptoo", "31220011", "0745678004", "Eldoret", 2, 0],
    ["Esther", "Njeri", "28990033", "0756789005", "Nakuru", 3, 1],
    ["Felix", "Mwangi", "32001177", "0767890006", "Nairobi", 5, 1],
    ["Grace", "Achieng", "29887766", "0778901007", "Kisumu", 6, 0],
    ["Hassan", "Abdi", "30556677", "0789012008", "Mombasa", 2, 2],
  ] as const;

  for (const [first, last, idn, phone, county, stagePos, jobIdx] of people) {
    const [c] = await sql`
      INSERT INTO candidates (tenant_id, first_name, last_name, id_number_enc, id_number_idx, phone, phone_norm, county, skills, preferred_countries, consent_at, created_by)
      VALUES (${T}, ${first}, ${last}, ${encrypt(idn)}, ${blindIndex(idn)}, ${phone}, ${normalizePhone(phone)}, ${county}, 'Hospitality, customer service', 'UAE, Qatar', now(), ${demo.ids.recruiter})
      RETURNING id`;
    const job = jobIdx === null ? null : jobs[jobIdx];
    const [p] = await sql`
      INSERT INTO placements (tenant_id, candidate_id, job_order_id, stage_id, payment_model)
      VALUES (${T}, ${c.id}, ${job?.id ?? null}, ${demo.stageIds[stagePos]}, ${job?.payment_model ?? null})
      RETURNING id`;
    // Documents: passport expiring soon for one candidate to light up the expiry alert
    const soon = first === "Caroline";
    await sql`
      INSERT INTO documents (tenant_id, candidate_id, doc_type, doc_number_enc, expiry_date, file_key, file_name, mime_type, status, verified_by, verified_at)
      VALUES (${T}, ${c.id}, 'Passport', ${encrypt("A" + idn)}, ${soon ? sql`current_date + 40` : sql`current_date + 900`},
              'seed/none', 'passport.pdf', 'application/pdf', ${stagePos >= 2 ? "verified" : "pending"},
              ${stagePos >= 2 ? demo.ids.documentation : null}, ${stagePos >= 2 ? sql`now()` : null})`;
    if (job?.payment_model === "employer_paid" && stagePos >= 2) {
      await sql`
        INSERT INTO costs (tenant_id, placement_id, category, amount_minor, payee, incurred_on, created_by) VALUES
          (${T}, ${p.id}, 'Passport', 450000, 'Immigration', current_date - 10, ${demo.ids.finance}),
          (${T}, ${p.id}, 'Medical', 850000, 'Afya Clinic', current_date - 5, ${demo.ids.finance})`;
    }
  }
  await sql`INSERT INTO stage_history (tenant_id, placement_id, to_stage_id, user_id, note)
            SELECT tenant_id, id, stage_id, ${demo.ids.recruiter}, 'Seeded' FROM placements WHERE tenant_id = ${T}`;

  await extras();
  console.log(`Seeded. Sign in with admin@demo.test / ${PASSWORD} (also recruiter@, docs@, finance@demo.test)`);
  console.log(`Second agency for isolation checks: admin@other.test / ${PASSWORD}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
