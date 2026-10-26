import { getCtx } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getFile } from "@/lib/storage";

// Documents are never served from a public path. Every download checks the session,
// is limited to the user's own agency by row-level security, and is written to the audit log.
export async function GET(_: Request, { params }: RouteContext<"/files/[id]">) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });

  const doc = await withTenant(ctx.tenantId, async (tx) => {
    const [d] = await tx`SELECT id, file_key, file_name, mime_type, doc_type FROM documents WHERE id = ${id}`;
    if (d) await audit(tx, ctx, "document.view", "document", d.id, { type: d.doc_type });
    return d;
  });
  if (!doc) return new Response("Not found", { status: 404 });

  try {
    const bytes = await getFile(doc.file_key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": doc.mime_type,
        "content-disposition": `inline; filename="${String(doc.file_name).replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new Response("File is not available", { status: 404 });
  }
}
