import { ActionForm } from "@/components/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { createJobOrder } from "@/app/actions/org";
import { requirePageCan } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { CURRENCIES } from "@/lib/money";

export default async function NewJobOrder() {
  const ctx = await requirePageCan("joborders:write");
  const employers = await withTenant(ctx.tenantId, (tx) => tx`SELECT id, company, country FROM employers ORDER BY company`);
  return (
    <div className="grid gap-4 max-w-2xl">
      <PageHeader title="New job order" sub="What an employer has asked for, and who pays the costs." />
      <div className="card">
        {employers.length === 0 ? (
          <p>Add an employer first.</p>
        ) : (
          <ActionForm action={createJobOrder} submit="Save job order" resetOnSuccess={false}>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="employer_id">Employer</label>
                <select id="employer_id" name="employer_id" required className="select">
                  {employers.map((e) => <option key={e.id} value={e.id}>{e.company} ({e.country})</option>)}
                </select>
              </div>
              <div><label className="label" htmlFor="title">Role</label><input id="title" name="title" required className="input" /></div>
              <div><label className="label" htmlFor="category">Job category</label><input id="category" name="category" className="input" placeholder="Nurse, driver, housekeeper" /></div>
              <div><label className="label" htmlFor="country">Destination country</label><input id="country" name="country" required className="input" /></div>
              <div><label className="label" htmlFor="quantity">Workers needed</label><input id="quantity" name="quantity" type="number" min={1} defaultValue={1} required className="input" /></div>
              <div><label className="label" htmlFor="salary">Salary</label><input id="salary" name="salary" placeholder="AED 1,300 / month" className="input" /></div>
              <div><label className="label" htmlFor="deadline">Deadline</label><input id="deadline" name="deadline" type="date" className="input" /></div>
              <div>
                <label className="label" htmlFor="payment_model">Who pays the costs</label>
                <select id="payment_model" name="payment_model" className="select" defaultValue="employer_paid">
                  <option value="employer_paid">Employer (agency fronts costs, repaid later)</option>
                  <option value="candidate_paid">Candidate pays</option>
                </select>
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <div><label className="label" htmlFor="fee">Placement fee per worker</label><input id="fee" name="fee" placeholder="0.00" className="input" /></div>
                <div>
                  <label className="label" htmlFor="fee_currency">Currency</label>
                  <select id="fee_currency" name="fee_currency" className="select" defaultValue="USD">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                </div>
              </div>
            </div>
            <div><label className="label" htmlFor="terms">Contract terms</label><textarea id="terms" name="terms" rows={3} className="textarea" /></div>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
