import { ActionForm } from "@/components/ActionForm";
import { requestWorkers } from "@/app/actions/employer";

export default function Request() {
  return (
    <div className="grid gap-4 max-w-2xl">
      <h1 className="h1">Request workers</h1>
      <div className="card">
        <p className="muted mb-3">Tell the agency what you need. It will check the details, agree the fee with you, and open the job order.</p>
        <ActionForm action={requestWorkers} submit="Send request" resetOnSuccess={false}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="title">Role</label><input id="title" name="title" required className="input" placeholder="Hotel housekeeper" /></div>
            <div><label className="label" htmlFor="category">Category</label><input id="category" name="category" className="input" placeholder="Hospitality" /></div>
            <div><label className="label" htmlFor="country">Country of work</label><input id="country" name="country" required className="input" /></div>
            <div><label className="label" htmlFor="quantity">Workers needed</label><input id="quantity" name="quantity" type="number" min={1} defaultValue={1} required className="input" /></div>
            <div><label className="label" htmlFor="salary">Salary offered</label><input id="salary" name="salary" className="input" placeholder="AED 1,300 / month" /></div>
            <div><label className="label" htmlFor="deadline">Needed by</label><input id="deadline" name="deadline" type="date" className="input" /></div>
          </div>
          <div><label className="label" htmlFor="terms">Contract terms and requirements</label><textarea id="terms" name="terms" rows={4} className="textarea" /></div>
        </ActionForm>
      </div>
    </div>
  );
}
