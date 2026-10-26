import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";
import { decrypt } from "@/lib/crypto";
import { otpauthUri, qrDataUrl } from "@/lib/totp";
import { ActionForm } from "@/components/ActionForm";
import { platformChangePassword, platformConfirmTotp, platformStartTotp } from "@/app/actions/platform";

export default async function PlatformSecurity() {
  const a = await requirePlatform();
  const [row] = await sql`SELECT * FROM platform_admin_get(${a.id})`;
  let qr: string | null = null, secret: string | null = null;
  if (!row.totp_enabled && row.totp_secret) {
    secret = decrypt(row.totp_secret);
    qr = await qrDataUrl(otpauthUri(secret, row.email, "Platform console"));
  }
  return (
    <>
      <h1 className="h1">My security</h1>
      <div className="card grid gap-3">
        <div className="flex items-center gap-3"><div className="h2">Two-step sign-in</div><span className={`badge ${row.totp_enabled ? "badge-good" : "badge-warn"}`}>{row.totp_enabled ? "On" : "Required"}</span></div>
        {!row.totp_enabled && !secret && <ActionForm action={platformStartTotp} submit="Set up" className="" resetOnSuccess={false}><></></ActionForm>}
        {!row.totp_enabled && secret && qr && (
          <div className="grid gap-3">
            <p>1. Scan with an authenticator app, or type the key in by hand.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code" width={220} height={220} />
            <code className="select-all bg-[#f1f3f6] rounded p-2 w-fit">{secret}</code>
            <p>2. Enter the 6-digit code the app shows.</p>
            <ActionForm action={platformConfirmTotp} submit="Turn on" resetOnSuccess={false}><div className="max-w-48"><label className="label" htmlFor="code">Code</label><input id="code" name="code" inputMode="numeric" required className="input" /></div></ActionForm>
          </div>
        )}
        {row.totp_enabled && <p className="muted">Two-step sign-in is required for platform administrators and cannot be turned off.</p>}
      </div>
      <div className="card">
        <div className="h2 mb-3">Change password</div>
        <ActionForm action={platformChangePassword} submit="Change password" className="grid gap-3 max-w-xs">
          <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" required className="input" /></div>
          <div><label className="label" htmlFor="next">New password (12+ characters)</label><input id="next" name="next" type="password" minLength={12} required className="input" /></div>
        </ActionForm>
      </div>
    </>
  );
}
