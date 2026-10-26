import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { OpeningFields } from "@/components/OpeningFields";
import { createJobOrder } from "@/app/actions/org";
import { requirePageCan } from "@/lib/session";
import { withTenant } from "@/lib/db";

export default async function NewOpening({ searchParams }: PageProps<"/job-orders/new">) {
  const ctx = await requirePageCan("joborders:write");
  const sp = await searchParams;
  const chosen = typeof sp.employer === "string" ? sp.employer : "";
  const companies = await withTenant(ctx.tenantId, (tx) => tx`SELECT id, company, country FROM employers ORDER BY company`);
  return (
    <div className="grid gap-4 max-w-2xl">
      <PageHeader title="New opening" sub="What a company needs, and what a recruit must meet to be put forward." />
      <div className="card">
        {companies.length === 0 ? (
          <p>Add the company first. <Link className="link" href="/employers/new">Add a company</Link></p>
        ) : (
          <ActionForm action={createJobOrder} submit="Save opening" resetOnSuccess={false}>
            <div>
              <label className="label" htmlFor="employer_id">Company</label>
              <select id="employer_id" name="employer_id" required className="select" defaultValue={chosen || undefined}>
                {companies.map((e) => <option key={e.id} value={e.id}>{e.company} ({e.country})</option>)}
              </select>
            </div>
            <OpeningFields newOne />
          </ActionForm>
        )}
      </div>
    </div>
  );
}
