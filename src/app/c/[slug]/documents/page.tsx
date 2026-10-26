import { withCandidate } from "@/lib/db";
import { requireCandidate } from "@/lib/portal-session";
import { DOC_TYPES } from "@/lib/stages";
import { ActionForm } from "@/components/ActionForm";
import { portalUpload } from "@/app/actions/portal";

export default async function Documents({ params }: PageProps<"/c/[slug]/documents">) {
  const { slug } = await params;
  const { agency, me } = await requireCandidate(slug);
  const docs = await withCandidate(agency.id, me.candidateId, (tx) =>
    tx`SELECT id, doc_type, status, expiry_date, file_name, (expiry_date - current_date) AS days FROM documents ORDER BY created_at DESC`);
  return (
    <>
      <h1 className="h1">My documents</h1>
      <div className="card grid gap-2">
        {docs.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2 last:border-0">
            <div>
              <div className="font-semibold">{d.doc_type}</div>
              <div className="muted text-xs">{d.file_name}{d.expiry_date ? ` · expires ${new Date(d.expiry_date).toLocaleDateString("en-KE")}` : ""}</div>
            </div>
            <div className="text-right">
              <span className={`badge ${d.status === "verified" ? "badge-good" : d.status === "rejected" ? "badge-bad" : "badge-warn"}`}>{d.status === "pending" ? "being checked" : d.status}</span>
              {d.days !== null && Number(d.days) < 60 && <div className="text-xs text-[var(--bad)]">{Number(d.days) < 0 ? "expired" : `expires in ${d.days} days`}</div>}
            </div>
          </div>
        ))}
        {docs.length === 0 && <p className="muted">You have not sent any documents yet.</p>}
      </div>
      <div className="card">
        <div className="h2 mb-2">Send a document</div>
        <p className="muted text-xs mb-2">Take a clear photo or scan. PDF, JPG or PNG, up to 8 MB.</p>
        <ActionForm action={portalUpload.bind(null, slug)} submit="Send document">
          <div><label className="label" htmlFor="doc_type">What is it?</label><select id="doc_type" name="doc_type" className="select !py-3">{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="doc_number">Document number</label><input id="doc_number" name="doc_number" className="input" /></div>
            <div><label className="label" htmlFor="expiry_date">Expiry date</label><input id="expiry_date" name="expiry_date" type="date" className="input" /></div>
          </div>
          <div><label className="label" htmlFor="file">Photo or file</label><input id="file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,image/*" required className="input" /></div>
        </ActionForm>
      </div>
    </>
  );
}
