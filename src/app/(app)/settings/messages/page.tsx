import Link from "next/link";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { getAccess } from "@/lib/plan";
import { getPlatformConfig } from "@/lib/platform-config";
import { smsConfigured } from "@/lib/providers/sms";
import { whatsappConfigured } from "@/lib/providers/whatsapp";
import { emailConfigured } from "@/lib/providers/email";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { removeSender, requestSender, saveMessaging } from "@/app/actions/org";

const STATUS: Record<string, [string, string]> = { approved: ["in use", "badge-good"], pending: ["waiting for approval", "badge-warn"], rejected: ["not approved", "badge-bad"] };

export default async function MessagesSettings() {
  const ctx = await requirePageCan("users:manage");
  const access = await getAccess(ctx.tenantId);
  const cfg = await getPlatformConfig();
  const d = await withTenant(ctx.tenantId, async (tx) => ({
    settings: (await tx`SELECT settings, sms_credits FROM tenants WHERE id = ${ctx.tenantId}`)[0],
    senders: await tx`SELECT * FROM tenant_senders`,
  }));
  const channels: string[] = d.settings.settings?.notify_channels ?? ["sms"];
  const sms = d.senders.find((s) => s.kind === "sms");
  const mail = d.senders.find((s) => s.kind === "email");
  const credits = Number(d.settings.sms_credits);
  const opts = [
    { k: "sms", label: "SMS", on: smsConfigured(cfg), ok: true, note: "Reaches every phone. Best for codes and reminders." },
    { k: "whatsapp", label: "WhatsApp", on: whatsappConfigured(), ok: access.features.whatsapp, note: "Needs a WhatsApp Business account and approved templates." },
    { k: "email", label: "Email", on: emailConfigured(cfg), ok: true, note: "Used when a candidate has given an email address." },
  ];

  const senderCard = (kind: "sms" | "email", cur: (typeof d.senders)[number] | undefined) => (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <b>{kind === "sms" ? "SMS sender ID" : "Email sender"}</b>
        {cur ? <span className={`badge ${STATUS[cur.status][1]}`}>{STATUS[cur.status][0]}</span> : <span className="badge">using the platform&apos;s</span>}
      </div>
      {cur && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-semibold">{kind === "email" && cur.display_name ? `${cur.display_name} <${cur.value}>` : cur.value}</span>
          <ActionForm action={removeSender.bind(null, kind)} confirm="Remove this sender? Your messages go back to using the platform's." submit="Remove" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
          {cur.note && <span className="muted text-xs">{cur.note}</span>}
        </div>
      )}
      <ActionForm action={requestSender.bind(null, kind)} submit={cur ? "Replace" : "Connect"} resetOnSuccess className={kind === "sms" ? "flex flex-wrap items-end gap-2" : "flex flex-wrap items-end gap-2"}>
        {kind === "email" && <div className="min-w-44 flex-1"><label className="label" htmlFor="display_name">Name people see</label><input id="display_name" name="display_name" className="input" placeholder="Sunrise Placements" /></div>}
        <div className="min-w-52 flex-1">
          <label className="label" htmlFor={`value_${kind}`}>{kind === "sms" ? "Sender ID (3 to 11 letters or numbers)" : "Email address you send from"}</label>
          <input id={`value_${kind}`} name="value" required className="input" placeholder={kind === "sms" ? "SUNRISE" : "jobs@yourcompany.com"} />
        </div>
      </ActionForm>
    </div>
  );

  return (
    <>
      <SettingsCard title="How candidates are messaged" desc="Candidates are told when they move forward, when an appointment is booked or close, when a fee is due, and when a document is about to expire.">
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

      {!access.singleInstall && (
        <SettingsCard title="SMS credits" desc={`Each text uses one credit (a long text uses more). Credits cost KES ${(cfg.credits.priceMinor / 100).toFixed(2)} each and are topped up as soon as you pay by M-Pesa.`}>
          <div className="flex items-center gap-4 flex-wrap">
            <div><div className="text-[28px] font-bold leading-none">{credits.toLocaleString("en-KE")}</div><div className="muted text-xs mt-1">credits left</div></div>
            {credits <= 5 && <span className="badge badge-warn">{credits === 0 ? "Texts are not being sent" : "Running low"}</span>}
            <Link className="btn btn-primary ml-auto" href="/billing#credits">Buy credits</Link>
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="Your sender names" desc={access.singleInstall ? "Send texts and emails under your own name." : "Send texts and emails under your own name instead of the platform's. A new sender is checked and registered first, so it waits for approval; until then the platform's name is used."}>
        <div className="grid gap-6 max-w-xl">
          {senderCard("sms", sms)}
          <div className="border-t border-[var(--line)]" />
          {senderCard("email", mail)}
        </div>
      </SettingsCard>
    </>
  );
}
