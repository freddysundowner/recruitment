import { ActionForm } from "@/components/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { createEmployer } from "@/app/actions/org";
import { requirePageCan } from "@/lib/session";

export default async function NewCompany() {
  await requirePageCan("employers:write");
  return (
    <div className="grid gap-4 max-w-2xl">
      <PageHeader title="Add company" sub="A company that needs workers. You add what it needs, as an opening, on the next screen." />
      <div className="card">
        <ActionForm action={createEmployer} submit="Save company" resetOnSuccess={false}>
          <input type="hidden" name="currency" value="USD" />
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="company">Company</label><input id="company" name="company" required className="input" /></div>
            <div><label className="label" htmlFor="country">Country</label><input id="country" name="country" required className="input" /></div>
            <div><label className="label" htmlFor="contact_name">Contact person</label><input id="contact_name" name="contact_name" className="input" /></div>
            <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" className="input" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" /></div>
          </div>
          <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} className="textarea" /></div>
        </ActionForm>
      </div>
    </div>
  );
}
