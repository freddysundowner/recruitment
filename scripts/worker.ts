import { config } from "dotenv";
import postgres from "postgres";
import { deliverMessage, OutOfCredits } from "../src/lib/send-message";
import { notifyCandidate } from "../src/lib/notify";
import { fmtDate, fmtDateTime } from "../src/lib/templates";
import { deleteFile } from "../src/lib/storage";
import { configFromSettings, stkQuery } from "../src/lib/mpesa";
import { buildConfig, type SettingRow } from "../src/lib/platform-config";
import { applyMpesaResult } from "../src/lib/mpesa-apply";

config({ path: ".env.local" });

// The worker is trusted server-side code, so it connects as the table owner and works across agencies.
// Every query below therefore names the tenant explicitly instead of relying on row-level security.
const url = process.env.WORKER_DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error("WORKER_DATABASE_URL (or MIGRATE_DATABASE_URL) is not set");
const sql = postgres(url, { onnotice: () => {} });

type Job = { id: string; tenant_id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number };

async function claim(): Promise<Job | undefined> {
  const [j] = await sql<Job[]>`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, tenant_id, kind, payload, attempts, max_attempts`;
  return j;
}

const platform = async () => buildConfig((await sql`SELECT key, value FROM platform_settings`) as unknown as SettingRow[]);

async function run(job: Job) {
  if (job.kind === "send_message") return deliverMessage(sql, job.payload.messageId as string, await platform());
  if (job.kind === "delete_file") return deleteFile(job.payload.key as string);
  throw new Error(`Unknown job kind: ${job.kind}`);
}

async function processDue(): Promise<number> {
  let n = 0;
  for (let j = await claim(); j; j = await claim()) {
    n++;
    try {
      await run(j);
      await sql`UPDATE jobs SET status = 'done', last_error = NULL WHERE id = ${j.id}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const final = j.attempts >= j.max_attempts || e instanceof OutOfCredits;
      await sql`
        UPDATE jobs SET status = ${final ? "failed" : "queued"}, last_error = ${msg},
          run_at = now() + (${j.attempts * j.attempts} * interval '1 minute')
        WHERE id = ${j.id}`;
      if (final && j.kind === "send_message") {
        await sql`UPDATE messages SET status = 'failed', error = ${msg} WHERE id = ${j.payload.messageId as string}`;
      }
      console.error(`job ${j.id} (${j.kind}) failed attempt ${j.attempts}: ${msg}`);
    }
  }
  return n;
}

// ---------------------------------------------------------------- reminders
// Safe to run as often as you like: every reminder carries a dedupe key, so none is sent twice.
async function schedule() {
  await sql`UPDATE jobs SET status = 'queued' WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`;
  await sql`DELETE FROM jobs WHERE status = 'done' AND created_at < now() - interval '30 days'`;

  const tenants = await sql`SELECT id FROM tenants WHERE status = 'active'`;
  for (const { id: tenantId } of tenants) {
    await sql.begin(async (tx) => {
      // Documents that are expiring or expired
      const docs = await tx`
        SELECT d.id, d.doc_type, (d.expiry_date - current_date) AS days,
               c.id AS cid, c.first_name, c.phone, c.email
        FROM documents d JOIN candidates c ON c.id = d.candidate_id
        WHERE d.tenant_id = ${tenantId} AND d.status <> 'rejected' AND d.expiry_date IS NOT NULL
          AND d.expiry_date <= current_date + 60 AND c.status <> 'inactive' AND c.source <> 'sample'`;
      for (const d of docs) {
        const days = Number(d.days);
        const bucket = days <= 0 ? 0 : days <= 7 ? 7 : days <= 30 ? 30 : 60;
        await notifyCandidate(tx as never, tenantId, { id: d.cid, name: d.first_name, phone: d.phone, email: d.email },
          "document_expiring", { doc: d.doc_type, days }, { dedupeKey: `doc:${d.id}:${bucket}` });
      }

      // Fees due today or in three days, while the candidate still owes money
      const fees = await tx`
        SELECT f.id, f.fee_type, f.amount_minor, f.due_on, (f.due_on - current_date) AS days,
               c.id AS cid, c.first_name, c.phone, c.email
        FROM fee_charges f JOIN placements p ON p.id = f.placement_id JOIN candidates c ON c.id = p.candidate_id
        WHERE f.tenant_id = ${tenantId} AND c.source <> 'sample' AND p.outcome <> 'closed' AND f.due_on IS NOT NULL
          AND f.due_on - current_date IN (0, 3)
          AND (SELECT COALESCE(sum(amount_minor), 0) FROM fee_charges WHERE placement_id = p.id)
              > (SELECT COALESCE(sum(amount_minor), 0) FROM payments WHERE placement_id = p.id AND party = 'candidate')`;
      for (const f of fees) {
        await notifyCandidate(tx as never, tenantId, { id: f.cid, name: f.first_name, phone: f.phone, email: f.email }, "fee_due",
          { fee: f.fee_type, amount: `KES ${(Number(f.amount_minor) / 100).toLocaleString("en-KE")}`, due: fmtDate(f.due_on) },
          { dedupeKey: `fee:${f.id}:${Number(f.days)}` });
      }

      // Appointments in the next day
      const appts = await tx`
        SELECT a.id, a.kind, a.scheduled_at, a.location, c.id AS cid, c.first_name, c.phone, c.email
        FROM appointments a JOIN placements p ON p.id = a.placement_id JOIN candidates c ON c.id = p.candidate_id
        WHERE a.tenant_id = ${tenantId} AND c.source <> 'sample' AND a.result = 'pending'
          AND a.scheduled_at BETWEEN now() AND now() + interval '26 hours'`;
      for (const a of appts) {
        await notifyCandidate(tx as never, tenantId, { id: a.cid, name: a.first_name, phone: a.phone, email: a.email }, "appointment_reminder",
          { kind: a.kind, when: fmtDateTime(a.scheduled_at), where: a.location }, { dedupeKey: `appt:${a.id}:24h` });
      }
    });
  }
}

// Safaricom sometimes never calls back. For requests with no answer, ask Safaricom directly.
async function reconcileMpesa() {
  const pending = await sql`
    SELECT r.id, r.tenant_id, r.purpose, r.checkout_request_id, r.created_at < now() - interval '24 hours' AS stale, t.settings
    FROM mpesa_requests r JOIN tenants t ON t.id = r.tenant_id
    WHERE r.status = 'pending' AND r.created_at < now() - interval '90 seconds'`;
  for (const r of pending) {
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${r.tenant_id}, true)`;
        if (r.stale) {
          await applyMpesaResult(tx as never, r.tenant_id, r.id, { resultCode: 1037, resultDesc: "No answer from the customer (expired)" });
          return;
        }
        const cfg = r.purpose !== "candidate_fee" ? (await platform()).mpesa : configFromSettings(r.settings);
        if (!cfg || !r.checkout_request_id) return;
        const q = await stkQuery(cfg, r.checkout_request_id);
        if (q.code !== null) await applyMpesaResult(tx as never, r.tenant_id, r.id, { resultCode: q.code, resultDesc: q.desc });
      });
    } catch (e) {
      console.error(`mpesa reconcile ${r.id}:`, e instanceof Error ? e.message : e);
    }
  }
}

// Tells each agency's admin before the subscription ends, and again just after, so nobody is surprised by read-only mode.
async function renewalReminders() {
  const due = await sql`
    SELECT t.id AS tenant_id, t.name, s.plan_code, s.current_period_end,
           (s.current_period_end::date - current_date) AS days,
           (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin' AND u.status = 'active' ORDER BY u.created_at LIMIT 1) AS email,
           (SELECT u.name FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin' AND u.status = 'active' ORDER BY u.created_at LIMIT 1) AS admin
    FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
    WHERE t.status = 'active' AND s.status <> 'cancelled' AND s.current_period_end::date - current_date IN (7, 3, 0, -3)`;
  for (const d of due) {
    if (!d.email) continue;
    const days = Number(d.days);
    const when = days > 0 ? `ends in ${days} days (${fmtDate(d.current_period_end)})` : days === 0 ? "ends today" : `ended ${-days} days ago. The account turns read-only a few days later`;
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${d.tenant_id}, true)`;
      const { queueMessage } = await import("../src/lib/notify");
      await queueMessage(tx as never, d.tenant_id, {
        channel: "email", to: d.email, template: "renewal", subject: `Your ${d.plan_code} plan ${days > 0 ? "ends soon" : "needs renewing"}`,
        body: `Hello ${d.admin},\n\nYour ${d.name} subscription ${when}.\n\nRenew with M-Pesa or card on the Billing page: ${process.env.APP_URL ?? ""}/billing\n\nYour data is safe either way.`,
        dedupeKey: `renew:${d.tenant_id}:${new Date(d.current_period_end).toISOString().slice(0, 10)}:${days}`,
      });
    });
  }
}

async function main() {
  const once = process.argv.includes("--once");
  if (once) {
    await schedule();
    await renewalReminders();
    await reconcileMpesa();
    const n = await processDue();
    console.log(`worker: ran ${n} job(s)`);
    await sql.end();
    return;
  }
  console.log("worker started");
  let stop = false;
  process.on("SIGTERM", () => (stop = true));
  process.on("SIGINT", () => (stop = true));
  let lastSchedule = 0;
  let lastMpesa = 0;
  while (!stop) {
    try {
      if (Date.now() - lastSchedule > 5 * 60_000) {
        await schedule();
        await renewalReminders();
        lastSchedule = Date.now();
      }
      if (Date.now() - lastMpesa > 60_000) {
        await reconcileMpesa();
        lastMpesa = Date.now();
      }
      await processDue();
    } catch (e) {
      console.error("worker loop error", e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
