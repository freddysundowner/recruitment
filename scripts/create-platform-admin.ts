import { config } from "dotenv";
import bcrypt from "bcryptjs";
import postgres from "postgres";

// Creates the first platform administrator (the person who runs the service).
//   PLATFORM_ADMIN_PASSWORD='...' npm run platform:admin -- you@example.com "Your Name"
config({ path: ".env.local" });

const [email, name] = process.argv.slice(2);
const password = process.env.PLATFORM_ADMIN_PASSWORD;
if (!email || !name || !password) {
  console.error('Usage: PLATFORM_ADMIN_PASSWORD="at least 12 characters" npm run platform:admin -- email "Full Name"');
  process.exit(1);
}
if (password.length < 12) {
  console.error("The password needs at least 12 characters.");
  process.exit(1);
}

async function main() {
  const sql = postgres(process.env.MIGRATE_DATABASE_URL!, { onnotice: () => {} });
  await sql`INSERT INTO platform_admins (email, name, password_hash) VALUES (${email}, ${name}, ${await bcrypt.hash(password!, 11)})`;
  console.log(`Created ${email}. Sign in at /platform/login; you will be asked to set up two-step sign-in.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
