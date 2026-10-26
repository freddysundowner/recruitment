import Link from "next/link";
import { ArrowRight, FlaskConical, Sparkles, Trash2, Upload, UserPlus } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActionForm } from "@/components/ActionForm";
import { loadSampleData, removeSampleData } from "@/app/actions/sample";

export default async function GettingStarted() {
  const ctx = await requireCtx();
  const admin = can(ctx.role, "users:manage");
  const sample = await withTenant(ctx.tenantId, async (tx) => Number((await tx`SELECT count(*) AS n FROM candidates WHERE source = 'sample'`)[0].n));
  return (
    <>
      <PageHeader title="Getting started" sub="Choose how you would like to begin. You can do both." />
      <div className="grid md:grid-cols-2 gap-4">
        <section className="card grid gap-3 content-start">
          <div className="stat-icon"><FlaskConical size={22} /></div>
          <div>
            <h2 className="h2">Explore with sample data</h2>
            <p className="muted mt-1">Adds ten candidates at different stages, three employers and three job orders, with documents, costs, a contract, an interview and a complaint. Move people through the pipeline and see how the checks work. Sample people are never sent messages or charged.</p>
          </div>
          {sample > 0 ? (
            <>
              <div className="badge badge-good w-fit">Sample data is loaded</div>
              {admin && (
                <ActionForm action={removeSampleData} submit="Remove all sample data" buttonClass="btn btn-danger" className="grid gap-2" confirm="Remove all sample candidates, employers and job orders? Your own records are not touched.">
                  <p className="muted text-sm flex items-center gap-2"><Trash2 size={15} /> Only the sample records are removed. Anything you added yourself stays.</p>
                </ActionForm>
              )}
              <Link href="/pipeline" className="btn btn-primary w-fit">Open the pipeline <ArrowRight size={15} /></Link>
            </>
          ) : admin ? (
            <ActionForm confirm="Add sample candidates, employers and job orders to your workspace? You can remove them at any time." action={loadSampleData} submit="Load sample data" resetOnSuccess={false}><></></ActionForm>
          ) : <p className="muted">Ask your agency admin to load the sample data.</p>}
        </section>

        <section className="card grid gap-3 content-start">
          <div className="stat-icon"><Sparkles size={22} /></div>
          <div>
            <h2 className="h2">Start with your own records</h2>
            <p className="muted mt-1">Bring in what you already have, then set up the rest as you go. The dashboard keeps a checklist of what is left.</p>
          </div>
          <div className="grid gap-2">
            <Link href="/candidates/import" className="dlg-option primary"><Upload size={18} /><span className="flex-1"><span className="t block">Import candidates from a spreadsheet</span><span className="d block">Your books or Excel, saved as CSV</span></span><ArrowRight size={16} className="muted" /></Link>
            <Link href="/candidates/new" className="dlg-option"><UserPlus size={18} /><span className="flex-1"><span className="t block">Add the first candidate</span><span className="d block">One at a time</span></span><ArrowRight size={16} className="muted" /></Link>
            <Link href="/employers/new" className="dlg-option"><ArrowRight size={18} /><span className="flex-1"><span className="t block">Add an employer</span><span className="d block">Then a job order for them</span></span><ArrowRight size={16} className="muted" /></Link>
          </div>
        </section>
      </div>
    </>
  );
}
