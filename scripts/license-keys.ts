import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * For the SELLER only. Run these on your own machine, never on a customer's server.
 *   npm run license:keys                       create your signing key pair (once)
 *   npm run license:issue -- --customer "Acme Recruiters" --days 365 --users 10 --updates-days 365
 *   npm run license:issue -- --customer "Acme Recruiters" --perpetual --users 25
 * The private key is stored in ~/.recruitment-licence/private.pem. Back it up: if it is lost, you cannot issue
 * keys for installs that already carry your public key. Never commit it, never copy it to a customer.
 */
const dir = join(homedir(), ".recruitment-licence");
const privatePath = join(dir, "private.pem");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const cmd = process.argv[2];

if (cmd === "generate") {
  if (existsSync(privatePath)) {
    console.error(`A signing key already exists at ${privatePath}. Refusing to overwrite it.`);
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log(`Private key saved to ${privatePath} (keep it secret and backed up).\n`);
  console.log("Put this public key in the LICENSE_PUBLIC_KEY setting of every install you ship:\n");
  console.log(publicKey.export({ type: "spki", format: "der" }).toString("base64"));
} else if (cmd === "issue") {
  const customer = arg("customer");
  if (!customer) {
    console.error('Give --customer "Name", and either --days N or --perpetual.');
    process.exit(1);
  }
  const days = arg("days");
  if (!days && !flag("perpetual")) {
    console.error("Give --days N for a time-limited key, or --perpetual for an outright purchase.");
    process.exit(1);
  }
  if (!existsSync(privatePath)) {
    console.error("No signing key yet. Run: npm run license:keys");
    process.exit(1);
  }
  const day = 864e5;
  const payload = {
    v: 1,
    customer,
    issued: new Date().toISOString(),
    expires: days ? new Date(Date.now() + Number(days) * day).toISOString() : null,
    users: arg("users") ? Number(arg("users")) : null,
    updatesUntil: arg("updates-days") ? new Date(Date.now() + Number(arg("updates-days")) * day).toISOString() : null,
  };
  const body = `RAK1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const sig = sign(null, Buffer.from(body), createPrivateKey(readFileSync(privatePath)));
  console.log(`${body}.${sig.toString("base64url")}`);
  console.error(`\nIssued for ${customer}: ${payload.expires ? `expires ${payload.expires.slice(0, 10)}` : "perpetual"}, ${payload.users ?? "unlimited"} staff accounts.`);
} else {
  console.error("Usage: license:keys   |   license:issue -- --customer \"Name\" (--days N | --perpetual) [--users N] [--updates-days N]");
  process.exit(1);
}
