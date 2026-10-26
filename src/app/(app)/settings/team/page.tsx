import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { ROLE_LABEL, STAFF_ROLES } from "@/lib/perms";
import { getAccess } from "@/lib/plan";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { addUser, setUserStatus } from "@/app/actions/org";
import { resetUser2fa } from "@/app/actions/account";

const ROLE_HINT: Record<string, string> = {
  admin: "Everything, including settings and billing",
  recruiter: "Candidates, employers, job orders and the pipeline",
  documentation: "Documents, visas, travel and the pipeline",
  finance: "Costs, payments, invoices and reports",
};

export default async function Team() {
  const ctx = await requirePageCan("users:manage");
  const users = await withTenant(ctx.tenantId, (tx) => tx`SELECT id, name, email, role, status, totp_enabled FROM users WHERE role <> 'employer' ORDER BY created_at`);
  const access = await getAccess(ctx.tenantId);
  const active = users.filter((u) => u.status === "active").length;

  return (
    <>
      <SettingsCard title="Team" badge={<span className="badge">{active}{access.maxUsers ? ` of ${access.maxUsers}` : ""} staff accounts</span>} desc="Everyone who works for your agency. Employers have their own logins, which you create from the employer's page.">
        <div className="overflow-x-auto -mx-[18px]">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Two-step</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><span className="font-semibold">{u.name}</span>{u.id === ctx.userId && <span className="badge badge-brand ml-2">you</span>}<div className="muted text-xs">{u.email}</div></td>
                  <td>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}<div className="muted text-xs">{ROLE_HINT[u.role]}</div></td>
                  <td>{u.totp_enabled ? <span className="badge badge-good">on</span> : <span className="badge">off</span>}</td>
                  <td><span className={`badge ${u.status === "active" ? "badge-good" : "badge-bad"}`}>{u.status}</span></td>
                  <td className="text-right whitespace-nowrap">
                    {u.totp_enabled && u.id !== ctx.userId && (
                      <ActionForm action={resetUser2fa.bind(null, u.id)} submit="Reset two-step" buttonClass="btn btn-sm mr-1" className="inline" confirm="Clear this person's two-step sign-in?"><></></ActionForm>
                    )}
                    {u.id !== ctx.userId && (
                      <ActionForm action={setUserStatus.bind(null, u.id, u.status === "active" ? "disabled" : "active")} confirm={u.status === "active" ? "Disable this account? They are signed out and cannot sign in until you enable it again." : undefined} submit={u.status === "active" ? "Disable" : "Enable"} buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>

      <SettingsCard title="Add a team member" desc="They sign in with their email and this temporary password, and can change it from their account menu.">
        <ActionForm action={addUser} submit="Add team member" className="grid gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" required className="input" /></div>
            <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" /></div>
            <div>
              <label className="label" htmlFor="role">Role</label>
              <select id="role" name="role" className="select" defaultValue="recruiter">{STAFF_ROLES.map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}</select>
            </div>
            <div><label className="label" htmlFor="password">Temporary password (10+ characters)</label><input id="password" name="password" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
          </div>
        </ActionForm>
      </SettingsCard>
    </>
  );
}
