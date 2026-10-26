import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActionForm } from "@/components/ActionForm";
import { importCandidates } from "@/app/actions/candidates";
import { requirePageCan } from "@/lib/session";

export default async function ImportCandidates() {
  await requirePageCan("candidates:write");
  return (
    <div className="grid gap-4 max-w-2xl">
      <PageHeader title="Import candidates" sub="Bring in a spreadsheet of people in one go."><Link href="/candidates" className="btn btn-ghost">Back to candidates</Link></PageHeader>
      <div className="card grid gap-3">
        <p>
          Bring in records from your books or a spreadsheet. Save it as CSV with a header row. Required columns:{" "}
          <code>first_name</code>, <code>last_name</code>, <code>phone</code>. Optional: <code>id_number</code>, <code>email</code>,{" "}
          <code>county</code>, <code>gender</code>, <code>skills</code>.
        </p>
        <pre className="bg-[#f1f3f6] rounded-lg p-3 text-xs overflow-x-auto">{`first_name,last_name,phone,id_number,county
Amina,Wanjiru,0712345678,29104455,Nairobi
Brian,Otieno,0723456789,30118822,Kisumu`}</pre>
        <ActionForm action={importCandidates} submit="Import" resetOnSuccess={false}>
          <div><label className="label" htmlFor="file">CSV file</label><input id="file" name="file" type="file" accept=".csv,text/csv" className="input" /></div>
          <div><label className="label" htmlFor="csv">Or paste CSV text</label><textarea id="csv" name="csv" rows={6} className="textarea font-mono text-xs" /></div>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="welcome" className="mt-1" />
            <span>Send each person a welcome message (uses your SMS credit).</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="consent" className="mt-1" />
            <span>Everyone in this file agreed to the agency storing and processing their personal data for recruitment.</span>
          </label>
        </ActionForm>
      </div>
    </div>
  );
}
