import { ActionForm } from "@/components/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { CandidateFields } from "@/components/CandidateFields";
import { createCandidate } from "@/app/actions/candidates";
import { requirePageCan } from "@/lib/session";

export default async function NewCandidate() {
  await requirePageCan("candidates:write");
  return (
    <div className="grid gap-4 max-w-2xl">
      <PageHeader title="Add candidate" sub="Record their consent, then collect their documents on the next screen." />
      <div className="card">
        <ActionForm action={createCandidate} submit="Register candidate" resetOnSuccess={false}>
          <CandidateFields />
          <label className="flex items-start gap-2">
            <input type="checkbox" name="consent" className="mt-1" />
            <span>The candidate has agreed to the agency storing and processing their personal data for recruitment.</span>
          </label>
        </ActionForm>
      </div>
    </div>
  );
}
