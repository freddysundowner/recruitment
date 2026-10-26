import Link from "next/link";
import { Download } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { SettingsCard } from "@/components/ui/SettingsCard";

export default async function Activity() {
  const ctx = await requirePageCan("users:manage");
  const rows = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT a.id, a.action, a.entity, a.detail, a.created_at, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.action <> 'document.view' ORDER BY a.created_at DESC LIMIT 100`);
  return (
    <SettingsCard title="Activity log" desc="A record of what has been done in your agency, by whom, and when. It cannot be edited or deleted. Platform support visits to your account also appear here."
      badge={<Link href="/export/audit" className="btn btn-sm"><Download size={14} /> Download all</Link>}>
      <div className="overflow-x-auto -mx-[18px]">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap muted">{new Date(a.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{a.who ?? (a.detail?.by ? `Platform: ${a.detail.by}` : <span className="muted">System</span>)}</td>
                <td>{String(a.action).replace(/[._]/g, " ")}{a.detail?.reason ? <span className="muted text-xs"> · {a.detail.reason}</span> : null}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </SettingsCard>
  );
}
