import type { Sql } from "./db";
import { enqueue } from "./queue";
import { normalizePhone } from "./phone";
import { renderTemplate, type TemplateName } from "./templates";

type Channel = "sms" | "whatsapp" | "email";
type Vars = Record<string, string | number>;

type Person = { id: string; phone?: string | null; email?: string | null; name: string };

async function tenantInfo(tx: Sql, tenantId: string): Promise<{ brand: string; channels: Channel[] }> {
  const [t] = await tx`
    SELECT t.name, t.settings, COALESCE((p.features->>'whatsapp')::boolean, true) AS wa
    FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN plans p ON p.code = s.plan_code WHERE t.id = ${tenantId}`;
  const s = (t?.settings ?? {}) as { brand_name?: string; notify_channels?: Channel[] };
  const wanted = s.notify_channels?.length ? s.notify_channels : (["sms"] as Channel[]);
  const channels = process.env.TENANT_MODE === "single" || t?.wa ? wanted : wanted.filter((c) => c !== "whatsapp");
  return { brand: s.brand_name || t?.name || "Your agency", channels: channels.length ? channels : (["sms"] as Channel[]) };
}

/** Writes the message to the log and queues it for delivery by the worker. Returns false if it was a duplicate. */
export async function queueMessage(
  tx: Sql,
  tenantId: string,
  m: {
    channel: Channel;
    to: string;
    subject?: string;
    body: string;
    template: string;
    candidateId?: string;
    employerId?: string;
    dedupeKey?: string;
    runAt?: Date;
  },
): Promise<boolean> {
  const [row] = await tx`
    INSERT INTO messages (tenant_id, channel, to_addr, subject, body, template, candidate_id, employer_id, dedupe_key)
    VALUES (${tenantId}, ${m.channel}, ${m.to}, ${m.subject ?? null}, ${m.body}, ${m.template}, ${m.candidateId ?? null},
            ${m.employerId ?? null}, ${m.dedupeKey ?? null})
    ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id`;
  if (!row) return false;
  await enqueue(tx, tenantId, "send_message", { messageId: row.id }, { runAt: m.runAt });
  return true;
}

/** Sends a templated message to a candidate on the channels the agency has turned on. */
export async function notifyCandidate(
  tx: Sql,
  tenantId: string,
  c: Person,
  template: TemplateName,
  vars: Vars,
  opts: { dedupeKey?: string; channels?: Channel[]; runAt?: Date } = {},
) {
  // Sample candidates have made-up phone numbers, so they are never sent anything.
  const [src] = await tx`SELECT source FROM candidates WHERE id = ${c.id}`;
  if (src?.source === "sample") return;
  const { brand, channels } = await tenantInfo(tx, tenantId);
  const { subject, body } = renderTemplate(template, { name: c.name, ...vars }, brand);
  const phone = c.phone ? normalizePhone(c.phone) : null;
  for (const ch of opts.channels ?? channels) {
    const to = ch === "email" ? c.email : phone;
    if (!to) continue;
    await queueMessage(tx, tenantId, {
      channel: ch,
      to,
      subject,
      body,
      template,
      candidateId: c.id,
      dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:${ch}` : undefined,
      runAt: opts.runAt,
    });
  }
}

/** Employers are contacted by email only. */
export async function notifyEmployer(
  tx: Sql,
  tenantId: string,
  e: { id: string; email?: string | null; company: string },
  template: TemplateName,
  vars: Vars,
  opts: { dedupeKey?: string } = {},
) {
  if (!e.email) return;
  const { brand } = await tenantInfo(tx, tenantId);
  const { subject, body } = renderTemplate(template, { company: e.company, ...vars }, brand);
  await queueMessage(tx, tenantId, { channel: "email", to: e.email, subject, body, template, employerId: e.id, dedupeKey: opts.dedupeKey });
}
