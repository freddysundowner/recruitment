import { requirePlatform } from "@/lib/platform";
import { ActionForm } from "@/components/ActionForm";
import { platformChangePassword } from "@/app/actions/platform";

export default async function PlatformSecurity() {
  await requirePlatform();
  return (
    <>
      <h1 className="h1">My password</h1>
      <div className="card">
        <ActionForm action={platformChangePassword} submit="Change password" className="grid gap-3 max-w-xs">
          <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" required className="input" /></div>
          <div><label className="label" htmlFor="next">New password (12+ characters)</label><input id="next" name="next" type="password" minLength={12} required className="input" /></div>
        </ActionForm>
      </div>
    </>
  );
}
