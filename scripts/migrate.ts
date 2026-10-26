import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { blindIndex, encrypt } from "../src/lib/crypto";
import { normalizePhone } from "../src/lib/phone";

config({ path: ".env.local" });

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error("MIGRATE_DATABASE_URL is not set");

const sql = postgres(url, { onnotice: () => {} });
const dir = join(process.cwd(), "db", "migrations");

/** Moves any plaintext ID and document numbers into their encrypted columns, then clears the plaintext. */
async function backfillEncryption() {
  const cands = await sql`SELECT id, id_number FROM candidates WHERE id_number IS NOT NULL`;
  for (const c of cands) {
    await sql`UPDATE candidates SET id_number_enc = ${encrypt(c.id_number)}, id_number_idx = ${blindIndex(c.id_number)}, id_number = NULL WHERE id = ${c.id}`;
  }
  const docs = await sql`SELECT id, doc_number FROM documents WHERE doc_number IS NOT NULL`;
  for (const d of docs) {
    await sql`UPDATE documents SET doc_number_enc = ${encrypt(d.doc_number)}, doc_number = NULL WHERE id = ${d.id}`;
  }
  // Phone numbers in a single international format, so the portal can find a candidate from what they type.
  const phones = await sql`SELECT id, tenant_id, phone FROM candidates WHERE phone_norm IS NULL`;
  const seen = new Set<string>();
  for (const c of phones) {
    const n = normalizePhone(c.phone);
    const k = `${c.tenant_id}:${n}`;
    if (!n || seen.has(k)) continue; // unparseable or duplicate numbers stay empty and are fixed by staff
    seen.add(k);
    await sql`UPDATE candidates SET phone_norm = ${n} WHERE id = ${c.id}`.catch(() => {});
  }
  if (cands.length || docs.length) console.log(`encrypted ${cands.length} ID number(s) and ${docs.length} document number(s)`);
}

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    console.log(`applying ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
  }
  await backfillEncryption();
  console.log("migrations up to date");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
