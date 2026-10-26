import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";
import { ActionForm } from "@/components/ActionForm";
import { createPlatformAdmin, setPlatformAdminStatus } from "@/app/actions/platform";

export default async function Admins() {
  const me = await requirePlatform();
  const rows = await sql`SELECT * FROM platform_admins_list()`;
  return (
    <>
      <h1 className="h1">Administrators</h1>
      <div className="card">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td><td>{a.email}</td>
                <td><span className={`badge ${a.status === "active" ? "badge-good" : "badge-bad"}`}>{a.status}</span></td>
                <td className="text-right">{a.id !== me.id && <ActionForm action={setPlatformAdminStatus.bind(null, a.id, a.status === "active" ? "disabled" : "active")} confirm={a.status === "active" ? "Disable this administrator? They can no longer sign in to the console." : undefined} submit={a.status === "active" ? "Disable" : "Enable"} buttonClass="btn btn-sm" className="inline"><></></ActionForm>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(
          <ActionForm confirm="Add this administrator? They will be able to see every agency." action={createPlatformAdmin} submit="Add administrator" className="grid gap-3 mt-4 pt-4 border-t border-[var(--line)]">
            <div className="grid sm:grid-cols-3 gap-3">
              <div><label className="label" htmlFor="a_name">Name</label><input id="a_name" name="name" required className="input" /></div>
              <div><label className="label" htmlFor="a_email">Email</label><input id="a_email" name="email" type="email" required className="input" /></div>
              <div><label className="label" htmlFor="a_pw">Temporary password (12+ characters)</label><input id="a_pw" name="password" type="password" minLength={12} required className="input" /></div>
            </div>
          </ActionForm>
        )}
      </div>
    </>
  );
}
