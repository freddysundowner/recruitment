import { config } from "dotenv";
import postgres from "postgres";
import { decrypt } from "../src/lib/crypto";
import { codeAt } from "../src/lib/totp";

// Development helper: prints the current two-step code for a staff or platform account, so a test environment
// can be driven without a phone. Never use it on a real system.
//   npm run dev:totp -- platform platform@demo.test
config({ path: ".env.local" });
if (process.env.NODE_ENV === "production") throw new Error("Not for production");
const [kind, email] = process.argv.slice(2);
async function main() {
const sql = postgres(process.env.MIGRATE_DATABASE_URL!, { onnotice: () => {} });
const [row] = kind === "platform"
  ? await sql`SELECT totp_secret FROM platform_admins WHERE lower(email) = lower(${email})`
  : await sql`SELECT totp_secret FROM users WHERE lower(email) = lower(${email})`;
if (!row?.totp_secret) console.error("No two-step secret set up for that account yet.");
else console.log(codeAt(decrypt(row.totp_secret), Date.now()));
await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
