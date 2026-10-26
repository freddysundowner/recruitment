import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { otpauthUri, qrDataUrl } from "@/lib/totp";
import { ActionForm } from "@/components/ActionForm";
import { changePassword, confirmTotp, disableTotp, startTotp } from "@/app/actions/account";

export default async function Security({ searchParams }: PageProps<"/account/security">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const u = await withTenant(ctx.tenantId, async (tx) => (await tx`
    SELECT u.email, u.totp_enabled, u.totp_secret, t.name AS agency, (t.settings->>'require_2fa')::boolean AS required
    FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ${ctx.userId}`)[0]);

  let qr: string | null = null;
  let secret: string | null = null;
  if (!u.totp_enabled && u.totp_secret) {
    secret = decrypt(u.totp_secret);
    qr = await qrDataUrl(otpauthUri(secret, u.email, u.agency));
  }

  return (
    <>
      <h1 className="h1">Account security</h1>
      {(sp.required || ctx.mustSetup2fa) && (
        <div className="alert">Your agency requires two-step sign-in. Turn it on below to keep using the system.</div>
      )}

      <div className="card grid gap-3">
        <div className="flex items-center gap-3">
          <div className="h2">Two-step sign-in</div>
          <span className={`badge ${u.totp_enabled ? "badge-good" : "badge-warn"}`}>{u.totp_enabled ? "On" : "Off"}</span>
        </div>
        {!u.totp_enabled && !secret && (
          <>
            <p className="muted">Use an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy. After your password you will enter a 6-digit code.</p>
            <ActionForm action={startTotp} submit="Set up" className="" resetOnSuccess={false}><></></ActionForm>
          </>
        )}
        {!u.totp_enabled && secret && qr && (
          <div className="grid gap-3">
            <p>1. Scan this code with your authenticator app, or type the key in by hand.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to add this account to your authenticator app" width={220} height={220} />
            <code className="select-all bg-[#f1f3f6] rounded p-2 w-fit">{secret}</code>
            <p>2. Enter the 6-digit code the app shows.</p>
            <ActionForm action={confirmTotp} submit="Turn on" resetOnSuccess={false}>
              <div className="max-w-48"><label className="label" htmlFor="code">Code</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="input" /></div>
            </ActionForm>
          </div>
        )}
        {u.totp_enabled && !u.required && (
          <ActionForm confirm="Turn off two-step sign-in? Your account will be protected by your password alone." action={disableTotp} submit="Turn off" buttonClass="btn btn-danger" resetOnSuccess={true}>
            <div className="max-w-xs"><label className="label" htmlFor="password">Confirm with your password</label><input id="password" name="password" type="password" required className="input" /></div>
          </ActionForm>
        )}
        {u.totp_enabled && u.required && <p className="muted">Your agency requires this, so it cannot be turned off.</p>}
      </div>

      <div className="card">
        <div className="h2 mb-3">Change password</div>
        <ActionForm action={changePassword} submit="Change password" className="grid gap-3 max-w-xs">
          <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" required className="input" /></div>
          <div><label className="label" htmlFor="next">New password (10+ characters)</label><input id="next" name="next" type="password" minLength={10} required className="input" /></div>
        </ActionForm>
      </div>
    </>
  );
}
