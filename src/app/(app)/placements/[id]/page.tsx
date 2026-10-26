import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";

/** Placements used to have a page of their own. Everything now lives on the candidate's page, so old links go there. */
export default async function Placement({ params }: PageProps<"/placements/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = await withTenant(ctx.tenantId, (tx) => tx`SELECT candidate_id FROM placements WHERE id = ${id}`);
  if (!p) notFound();
  redirect(`/candidates/${p.candidate_id}`);
}
