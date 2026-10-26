import { requireCtx } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { changePassword } from "@/app/actions/account";

export default async function Security() {
  await requireCtx();
  return (
    <>
      <h1 className="h1">Change password</h1>
      <div className="card">
        <ActionForm action={changePassword} submit="Change password" className="grid gap-3 max-w-xs">
          <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" required className="input" /></div>
          <div><label className="label" htmlFor="next">New password (8+ characters)</label><input id="next" name="next" type="password" minLength={8} required className="input" /></div>
        </ActionForm>
      </div>
    </>
  );
}
