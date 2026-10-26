import { getCtx } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/perms";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { toCsv } from "@/lib/csv";
import { getAccess } from "@/lib/plan";

const KINDS = ["candidates", "placements", "deployments", "costs", "payments", "invoices", "audit"] as const;
type Kind = (typeof KINDS)[number];

const money = (minor: unknown) => (Number(minor) / 100).toFixed(2);

// Exports are checked against the signed-in role, limited to the user's own agency by row-level
// security, and written to the audit log. ID numbers are included for admins only.
export async function GET(req: Request, { params }: RouteContext<"/export/[kind]">) {
  const ctx = await getCtx();
  if (!ctx || ctx.role === "employer") return new Response("Unauthorized", { status: 401 });
  if (!(await getAccess(ctx.tenantId)).features.exports) return new Response("Exports are not part of your plan", { status: 403 });
  const { kind } = await params;
  if (!KINDS.includes(kind as Kind)) return new Response("Not found", { status: 404 });
  const money_kinds: Kind[] = ["costs", "payments", "invoices"];
  if (money_kinds.includes(kind as Kind) && !can(ctx.role, "finance:read")) return new Response("Forbidden", { status: 403 });
  if (kind === "audit" && !can(ctx.role, "users:manage")) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : "1900-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : "2999-12-31";
  const withIds = can(ctx.role, "users:manage");

  const rows = await withTenant(ctx.tenantId, async (tx) => {
    let out: (string | number | boolean | Date | null)[][] = [];
    if (kind === "candidates") {
      const r = await tx`
        SELECT c.*, s.name AS stage FROM candidates c
        LEFT JOIN placements p ON p.candidate_id = c.id AND p.outcome <> 'closed' LEFT JOIN pipeline_stages s ON s.id = p.stage_id
        WHERE c.created_at::date BETWEEN ${from} AND ${to} ORDER BY c.created_at`;
      out = [["First name", "Last name", ...(withIds ? ["ID number"] : []), "Phone", "Email", "County", "Gender", "Status", "Stage", "Registered"],
        ...r.map((c) => [c.first_name, c.last_name, ...(withIds ? [c.id_number_enc ? decrypt(c.id_number_enc) : ""] : []), c.phone, c.email, c.county, c.gender, c.status, c.stage, c.created_at])];
    } else if (kind === "placements" || kind === "deployments") {
      const r = await tx`
        SELECT p.*, c.first_name, c.last_name, c.phone, c.id_number_enc, s.name AS stage, j.title, j.country, j.category, e.company,
               t.departure_on, t.arrival_confirmed_on, t.employer_start_on, t.visa_status
        FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN pipeline_stages s ON s.id = p.stage_id
        LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
        LEFT JOIN placement_travel t ON t.placement_id = p.id
        WHERE p.created_at::date BETWEEN ${from} AND ${to}
          ${kind === "deployments" ? tx`AND (p.outcome = 'deployed' OR t.departure_on IS NOT NULL)` : tx``}
        ORDER BY p.created_at`;
      out = kind === "deployments"
        ? [["Worker", ...(withIds ? ["ID number"] : []), "Phone", "Destination", "Employer", "Role", "Departed", "Arrival confirmed", "Started work", "Outcome"],
           ...r.map((p) => [`${p.first_name} ${p.last_name}`, ...(withIds ? [p.id_number_enc ? decrypt(p.id_number_enc) : ""] : []), p.phone, p.country, p.company, p.title, p.departure_on, p.arrival_confirmed_on, p.employer_start_on, p.outcome])]
        : [["Candidate", "Phone", "Employer", "Role", "Country", "Category", "Stage", "Outcome", "Costs paid by", "Visa", "Started", "Closed reason"],
           ...r.map((p) => [`${p.first_name} ${p.last_name}`, p.phone, p.company, p.title, p.country, p.category, p.stage, p.outcome, p.payment_model, p.visa_status, p.created_at, p.close_reason])];
    } else if (kind === "costs") {
      const r = await tx`
        SELECT x.*, c.first_name, c.last_name FROM costs x JOIN placements p ON p.id = x.placement_id JOIN candidates c ON c.id = p.candidate_id
        WHERE x.incurred_on BETWEEN ${from} AND ${to} ORDER BY x.incurred_on`;
      out = [["Date", "Candidate", "Category", "Paid to", "Receipt", "Currency", "Amount", "Reversal"], ...r.map((x) => [x.incurred_on, `${x.first_name} ${x.last_name}`, x.category, x.payee, x.receipt_ref, x.currency, money(x.amount_minor), x.reverses_id ? "yes" : ""])];
    } else if (kind === "payments") {
      const r = await tx`
        SELECT x.*, c.first_name, c.last_name FROM payments x JOIN placements p ON p.id = x.placement_id JOIN candidates c ON c.id = p.candidate_id
        WHERE x.paid_on BETWEEN ${from} AND ${to} ORDER BY x.paid_on`;
      out = [["Receipt", "Date", "From", "Candidate", "Method", "Reference", "Currency", "Amount"], ...r.map((x) => [x.receipt_no, x.paid_on, x.party, `${x.first_name} ${x.last_name}`, x.method, x.reference, x.currency, money(x.amount_minor)])];
    } else if (kind === "invoices") {
      const r = await tx`
        SELECT i.*, e.company, i.amount_minor - COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0) AS balance
        FROM invoices i JOIN employers e ON e.id = i.employer_id WHERE i.issued_on BETWEEN ${from} AND ${to} ORDER BY i.issued_on`;
      out = [["Number", "Employer", "Issued", "Due", "Currency", "Amount", "Balance", "Rate to KES", "Status"], ...r.map((i) => [i.number, i.company, i.issued_on, i.due_on, i.currency, money(i.amount_minor), money(i.balance), i.fx_rate_to_kes, i.status])];
    } else {
      const r = await tx`
        SELECT a.*, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.created_at::date BETWEEN ${from} AND ${to} ORDER BY a.created_at`;
      out = [["Time", "Who", "Action", "Entity", "Detail"], ...r.map((a) => [a.created_at.toISOString(), a.who, a.action, a.entity, JSON.stringify(a.detail)])];
    }
    await audit(tx, ctx, "export", kind, null, { rows: out.length - 1, from, to });
    return out;
  });

  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
