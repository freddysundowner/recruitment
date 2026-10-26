import Link from "next/link";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { getAccess } from "@/lib/plan";
import { smsConfigured } from "@/lib/providers/sms";
import { whatsappConfigured } from "@/lib/providers/whatsapp";
import { emailConfigured } from "@/lib/providers/email";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { saveMessaging } from "@/app/actions/org";

export default async function MessagesSettings() {
  const ctx = await requirePageCan("users:manage");
  const t = await withTenant(ctx.tenantId, async (tx) => (await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`)[0]);
  const access = await getAccess(ctx.tenantId);
  const channels: string[] = t.settings?.notify_channels ?? ["sms"];
  const opts = [
    { k: "sms", label: "SMS", on: smsConfigured(), ok: true, note: "Reaches every phone. Best for codes and reminders." },
    { k: "whatsapp", label: "WhatsApp", on: whatsappConfigured(), ok: access.features.whatsapp, note: "Needs a WhatsApp Business account and approved templates." },
    { k: "email", label: "Email", on: emailConfigured(), ok: true, note: "Used when a candidate has given an email address." },
  ];
  return (
    <SettingsCard title="How candidates are messaged" desc="Candidates are told when they move forward, when an appointment is booked or close, when a fee is due, and when a document is about to expire. Choose every channel you want used.">
      <ActionForm action={saveMessaging} submit="Save" resetOnSuccess={false} className="grid gap-3 max-w-xl">
        {opts.map((o) => (
          <label key={o.k} className="flex items-start gap-3 p-3 rounded-xl border border-[var(--line)]" style={!o.ok ? { opacity: 0.6 } : undefined}>
            <input type="checkbox" name={`ch_${o.k}`} defaultChecked={channels.includes(o.k)} disabled={!o.ok} className="mt-1" />
            <span className="flex-1">
              <span className="flex items-center gap-2 flex-wrap font-semibold">{o.label}
                {!o.ok ? <span className="badge">not in your plan</span> : <span className={`badge ${o.on ? "badge-good" : "badge-warn"}`}>{o.on ? "connected" : "not connected yet"}</span>}
              </span>
              <span className="block muted text-xs">{o.note}</span>
            </span>
          </label>
        ))}
        <p className="muted text-xs">Until a channel is connected, messages are recorded but not delivered. You can see exactly what was sent, and what failed, on the <Link className="link" href="/messages">Messages</Link> page.</p>
      </ActionForm>
    </SettingsCard>
  );
}
