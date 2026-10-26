import { withCandidate } from "@/lib/db";
import { getAgency, getCandidateCtx } from "@/lib/portal-session";
import { decrypt } from "@/lib/crypto";

// A candidate's right to a copy of their own information. Everything below runs inside that one candidate's session.
export async function GET(_: Request, { params }: RouteContext<"/c/[slug]/export">) {
  const { slug } = await params;
  const agency = await getAgency(slug);
  const me = agency ? await getCandidateCtx(agency.id) : null;
  if (!agency || !me) return new Response("Unauthorized", { status: 401 });

  const data = await withCandidate(agency.id, me.candidateId, async (tx) => {
    const [c] = await tx`SELECT * FROM candidates WHERE id = ${me.candidateId}`;
    await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id) VALUES (${agency.id}, 'data.export', 'candidate', ${me.candidateId})`;
    return {
      exported_at: new Date().toISOString(),
      agency: agency.name,
      profile: {
        first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email, county: c.county, gender: c.gender, dob: c.dob,
        id_number: c.id_number_enc ? decrypt(c.id_number_enc) : null, skills: c.skills, experience: c.experience,
        preferred_countries: c.preferred_countries, registered: c.created_at, consent_given: c.consent_at,
      },
      documents: await tx`SELECT doc_type, issue_date, expiry_date, status, file_name, created_at FROM documents`,
      applications: await tx`SELECT job_order_id, status, created_at FROM applications`,
      placements: await tx`SELECT p.outcome, p.close_reason, p.created_at, s.name AS stage FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id`,
      fees: await tx`SELECT fee_type, amount_minor, currency, due_on FROM fee_charges`,
      payments: await tx`SELECT receipt_no, method, amount_minor, currency, reference, paid_on FROM payments`,
      messages: await tx`SELECT channel, body, status, created_at FROM messages WHERE template <> 'otp'`,
      complaints: await tx`SELECT subject, body, status, resolution, created_at FROM complaints`,
    };
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="my-information-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
