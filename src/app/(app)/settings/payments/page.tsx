import Link from "next/link";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { getAccess } from "@/lib/plan";
import { mockMode } from "@/lib/mpesa";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { setFeeCap } from "@/app/actions/org";
import { saveMpesaSettings } from "@/app/actions/mpesa";

export default async function Payments() {
  const ctx = await requirePageCan("users:manage");
  const t = await withTenant(ctx.tenantId, async (tx) => (await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`)[0]);
  const access = await getAccess(ctx.tenantId);
  const mpesa = t.settings?.mpesa as Record<string, string> | undefined;
  const cap = t.settings?.max_candidate_fee_minor;
  const set = Boolean(mpesa?.consumer_key_enc);

  return (
    <>
      <SettingsCard id="mpesa" title="M-Pesa collections"
        badge={mockMode() ? <span className="badge badge-warn">demo mode</span> : <span className={`badge ${set ? "badge-good" : ""}`}>{set ? `set up (${mpesa!.env})` : "not set up"}</span>}
        desc="Lets staff send a payment prompt to a candidate's phone, and lets candidates pay from their own page. Get these details from the Safaricom Daraja portal. Secrets are stored encrypted and never shown again.">
        {access.features.mpesa ? (
          <ActionForm action={saveMpesaSettings} submit="Save M-Pesa settings" resetOnSuccess={false} className="grid gap-4 max-w-xl">
            <div className="grid sm:grid-cols-3 gap-3">
              <div><label className="label" htmlFor="mp_env">Environment</label><select id="mp_env" name="env" className="select" defaultValue={mpesa?.env ?? "sandbox"}><option value="sandbox">Sandbox (testing)</option><option value="production">Production</option></select></div>
              <div><label className="label" htmlFor="mp_type">Account type</label><select id="mp_type" name="type" className="select" defaultValue={mpesa?.type ?? "paybill"}><option value="paybill">Paybill</option><option value="till">Till</option></select></div>
              <div><label className="label" htmlFor="mp_sc">Shortcode</label><input id="mp_sc" name="shortcode" defaultValue={mpesa?.shortcode ?? ""} className="input" /></div>
            </div>
            <div><label className="label" htmlFor="mp_ck">Consumer key</label><input id="mp_ck" name="consumer_key" autoComplete="off" className="input" placeholder={mpesa?.consumer_key_enc ? "•••••• saved, leave empty to keep" : ""} /></div>
            <div><label className="label" htmlFor="mp_cs">Consumer secret</label><input id="mp_cs" name="consumer_secret" type="password" autoComplete="off" className="input" placeholder={mpesa?.consumer_secret_enc ? "•••••• saved, leave empty to keep" : ""} /></div>
            <div><label className="label" htmlFor="mp_pk">Passkey</label><input id="mp_pk" name="passkey" type="password" autoComplete="off" className="input" placeholder={mpesa?.passkey_enc ? "•••••• saved, leave empty to keep" : ""} /></div>
          </ActionForm>
        ) : <p className="muted">M-Pesa collection is not part of your plan. <Link className="link" href="/billing">Upgrade</Link> to turn it on.</p>}
      </SettingsCard>

      <SettingsCard title="Candidate fee limit" desc="The most a single candidate can be charged in total. Any fee that would take them above it is blocked. Leave empty for no limit.">
        <ActionForm action={setFeeCap} submit="Save limit" resetOnSuccess={false} className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="label" htmlFor="cap">Limit in KES{cap ? `, currently ${(Number(cap) / 100).toLocaleString("en-KE")}` : ", currently none"}</label>
            <input id="cap" name="cap" className="input" placeholder="25000.00" style={{ width: 200 }} />
          </div>
        </ActionForm>
      </SettingsCard>
    </>
  );
}
