import { requirePlatform } from "@/lib/platform";
import { getRawSettings, BLESSEDTEXTS_URL } from "@/lib/platform-config";
import { ActionForm } from "@/components/ActionForm";
import { savePlatformSection } from "@/app/actions/platform";

type Raw = Record<string, unknown>;
const s = (o: Raw | undefined, k: string) => (typeof o?.[k] === "string" ? (o[k] as string) : "");
const set = (o: Raw | undefined, k: string) => typeof o?.[`${k}_enc`] === "string";

function Secret({ section, name, label, saved, hint }: { section: string; name: string; label: string; saved: boolean; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={`${section}_${name}`}>{label} {saved && <span className="badge badge-good ml-1">saved</span>}</label>
      <input id={`${section}_${name}`} name={name} type="password" autoComplete="off" className="input" placeholder={saved ? "Leave blank to keep what is saved" : ""} />
      {hint && <div className="muted text-xs mt-1">{hint}</div>}
    </div>
  );
}
function Text({ section, name, label, value, placeholder, hint }: { section: string; name: string; label: string; value: string; placeholder?: string; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={`${section}_${name}`}>{label}</label>
      <input id={`${section}_${name}`} name={name} defaultValue={value} className="input" placeholder={placeholder} />
      {hint && <div className="muted text-xs mt-1">{hint}</div>}
    </div>
  );
}

export default async function PlatformSettings() {
  const admin = await requirePlatform();
  const all = (await getRawSettings()) as Record<string, Raw>;
  const f = (section: string, children: React.ReactNode) => (
    <ActionForm action={savePlatformSection.bind(null, section)} confirm="Save these settings? They apply to every agency straight away." submit={admin.totpEnabled ? "Save" : undefined} resetOnSuccess={false} className="grid gap-3">
      {children}
    </ActionForm>
  );
  const card = (title: string, desc: string, body: React.ReactNode) => (
    <section className="card grid gap-3">
      <div><div className="h2">{title}</div><p className="muted text-sm">{desc}</p></div>
      {body}
    </section>
  );
  const sg = all.signup, cr = all.credits, sms = all.sms, em = all.email, mp = all.mpesa, st = all.stripe;

  return (
    <>
      <div>
        <h1 className="h1">Settings</h1>
        <p className="muted">Everything about running the service lives here. Anything left empty falls back to the server&apos;s environment file.{!admin.totpEnabled && " Turn on two-step sign-in under My security to be able to save."}</p>
      </div>

      {card("Sign-up", "Who can create a workspace, and how long the free trial lasts.", f("signup", (
        <>
          <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={typeof sg?.enabled === "boolean" ? (sg.enabled as boolean) : true} /> Let new agencies sign up</label>
          <div className="max-w-xs"><Text section="signup" name="trial_days" label="Free trial (days)" value={String(sg?.trial_days ?? "")} placeholder="7" /></div>
        </>
      )))}

      {card("SMS credits", "Every new agency gets some free credits. After that they buy more by M-Pesa, and the credits are added to their account automatically.", f("credits", (
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <Text section="credits" name="free_on_signup" label="Free credits at sign-up" value={String(cr?.free_on_signup ?? "")} placeholder="20" />
          <Text section="credits" name="price_minor" label="Price per credit (KES)" value={typeof cr?.price_minor === "number" ? ((cr.price_minor as number) / 100).toFixed(2) : ""} placeholder="0.40" />
        </div>
      )))}

      {card("SMS (BlessedTexts)", "Texts from every agency go out through this account. An agency's own sender ID is used once you approve it.", f("sms", (
        <div className="grid sm:grid-cols-2 gap-3">
          <Secret section="sms" name="api_key" label="API key" saved={set(sms, "api_key")} />
          <Text section="sms" name="sender_id" label="Default sender ID" value={s(sms, "sender_id")} placeholder="23107" hint="Used for agencies that have not connected their own." />
          <div className="sm:col-span-2"><Text section="sms" name="endpoint" label="Sending address" value={s(sms, "endpoint")} placeholder={BLESSEDTEXTS_URL} hint="Leave empty to use BlessedTexts' standard address." /></div>
        </div>
      )))}

      {card("Email (Brevo)", "Emails from every agency go out through this account. An agency's own sender address must be verified in Brevo first; approve it on the Sender IDs page once it is.", f("email", (
        <div className="grid sm:grid-cols-2 gap-3">
          <Secret section="email" name="api_key" label="Brevo API key" saved={set(em, "api_key")} />
          <div />
          <Text section="email" name="from_email" label="Default sender address" value={s(em, "from_email")} placeholder="no-reply@yourdomain.com" />
          <Text section="email" name="from_name" label="Default sender name" value={s(em, "from_name")} placeholder="Recruitment System" />
        </div>
      )))}

      {card("M-Pesa (payments to you)", "The paybill or till that receives subscriptions and SMS credit purchases. Agencies' own M-Pesa for candidate fees is set by each agency.", f("mpesa", (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="mpesa_env">Environment</label>
            <select id="mpesa_env" name="env" className="select" defaultValue={s(mp, "env") || "sandbox"}><option value="sandbox">Sandbox (testing)</option><option value="production">Production (real money)</option></select>
          </div>
          <div>
            <label className="label" htmlFor="mpesa_type">Account type</label>
            <select id="mpesa_type" name="type" className="select" defaultValue={s(mp, "type") || "paybill"}><option value="paybill">Paybill</option><option value="till">Till (buy goods)</option></select>
          </div>
          <Text section="mpesa" name="shortcode" label="Paybill or till number" value={s(mp, "shortcode")} />
          <Secret section="mpesa" name="passkey" label="Passkey" saved={set(mp, "passkey")} />
          <Secret section="mpesa" name="consumer_key" label="Consumer key" saved={set(mp, "consumer_key")} />
          <Secret section="mpesa" name="consumer_secret" label="Consumer secret" saved={set(mp, "consumer_secret")} />
        </div>
      )))}

      {card("Card payments (Stripe)", "Optional. Lets agencies pay their subscription by card.", f("stripe", (
        <div className="grid sm:grid-cols-2 gap-3">
          <Secret section="stripe" name="secret_key" label="Secret key" saved={set(st, "secret_key")} />
          <Secret section="stripe" name="webhook_secret" label="Webhook signing secret" saved={set(st, "webhook_secret")} />
        </div>
      )))}
    </>
  );
}
