import { ActionForm } from "@/components/ActionForm";
import { createEmployer } from "@/app/actions/org";
import { requirePageCan } from "@/lib/session";
import { CURRENCIES } from "@/lib/money";

export default async function NewEmployer() {
  await requirePageCan("employers:write");
  return (
    <div className="grid gap-4 max-w-2xl">
      <h1 className="h1">Add employer</h1>
      <div className="card">
        <ActionForm action={createEmployer} submit="Save employer" resetOnSuccess={false}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="company">Company</label><input id="company" name="company" required className="input" /></div>
            <div><label className="label" htmlFor="country">Country</label><input id="country" name="country" required className="input" /></div>
            <div><label className="label" htmlFor="contact_name">Contact person</label><input id="contact_name" name="contact_name" className="input" /></div>
            <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" /></div>
            <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" className="input" /></div>
            <div>
              <label className="label" htmlFor="currency">Invoice currency</label>
              <select id="currency" name="currency" className="select" defaultValue="USD">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
          </div>
          <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={3} className="textarea" /></div>
        </ActionForm>
      </div>
    </div>
  );
}
