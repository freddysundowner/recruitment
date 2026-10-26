import Link from "next/link";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { smsConfigured } from "@/lib/providers/sms";
import { whatsappConfigured } from "@/lib/providers/whatsapp";
import { emailConfigured } from "@/lib/providers/email";

export default async function Messages() {
  const ctx = await requireCtx();
  const d = await withTenant(ctx.tenantId, async (tx) => ({
    rows: await tx`
      SELECT m.id, m.channel, m.to_addr, m.status, m.template, m.error, m.provider_ref, m.created_at,
             CASE WHEN m.template = 'otp' THEN 'Sign-in code' ELSE left(m.body, 110) END AS body, c.id AS cid, c.first_name, c.last_name
      FROM messages m LEFT JOIN candidates c ON c.id = m.candidate_id ORDER BY m.created_at DESC LIMIT 100`,
    counts: (await tx`SELECT count(*) FILTER (WHERE status = 'queued') AS queued, count(*) FILTER (WHERE status = 'failed') AS failed FROM messages`)[0],
  }));
  const providers = [["SMS", smsConfigured()], ["WhatsApp", whatsappConfigured()], ["Email", emailConfigured()]] as const;
  return (
    <div className="grid gap-4">
      <h1 className="h1">Messages</h1>
      <div className="card flex flex-wrap items-center gap-3">
        {providers.map(([n, on]) => <span key={n} className={`badge ${on ? "badge-good" : "badge-warn"}`}>{n}: {on ? "connected" : "not connected, messages are only recorded"}</span>)}
        <span className="muted text-sm">{Number(d.counts.queued)} waiting · {Number(d.counts.failed)} failed</span>
      </div>
      {Number(d.counts.queued) > 20 && <div className="alert">Many messages are waiting. The background worker may not be running.</div>}
      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>To</th><th>Channel</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>
            {d.rows.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">{new Date(m.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{m.cid ? <Link className="link" href={`/candidates/${m.cid}`}>{m.first_name} {m.last_name}</Link> : m.to_addr}<div className="muted text-xs">{m.cid ? m.to_addr : ""}</div></td>
                <td><span className="badge">{m.channel}</span></td>
                <td>{m.body}</td>
                <td><span className={`badge ${m.status === "sent" ? "badge-good" : m.status === "failed" ? "badge-bad" : "badge-warn"}`}>{m.status}</span>{m.error && <div className="text-xs text-[var(--bad)]">{m.error}</div>}{m.provider_ref?.startsWith("not-delivered") && <div className="muted text-xs">not delivered (no provider)</div>}</td>
              </tr>
            ))}
            {d.rows.length === 0 && <tr><td colSpan={5} className="muted">No messages yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
