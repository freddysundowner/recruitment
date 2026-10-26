// Platform console pages, and every main page at phone width (no sideways scrolling, nothing cut off).
//   node e2e/platform-and-mobile.mjs   (needs a platform admin: PLATFORM_ADMIN_PASSWORD=... npm run platform:admin -- e2e-admin@platform.test "E2E Admin")
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const cache = join(homedir(), "Library/Caches/ms-playwright");
const dir = readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop();
const exe = join(cache, dir, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const browser = await chromium.launch({ executablePath: exe, headless: true });
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed += 1; };
const errorsOn = (p, bag) => { p.on("pageerror", (e) => bag.push(e.message)); };

// ---- platform console
{
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  page.setDefaultTimeout(15000);
  const bag = [];
  errorsOn(page, bag);
  await page.goto(`${BASE}/platform/login`);
  await page.locator("#email").fill(process.env.PLATFORM_EMAIL ?? "e2e-admin@platform.test");
  await page.locator("#password").fill(process.env.PLATFORM_PASSWORD ?? "e2e-platform-pass-1");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/platform(?!\/login)/);
  for (const [path, label] of [["/platform", "Overview"], ["/platform/tenants", "Agencies"], ["/platform/payments", "Payments"], ["/platform/plans", "Plans"], ["/platform/senders", "Sender IDs"], ["/platform/settings", "Settings"], ["/platform/admins", "Administrators"], ["/platform/security", "My security"]]) {
    await page.goto(`${BASE}${path}`);
    await page.locator("main").first().waitFor();
    const text = await page.locator("body").innerText();
    check(!/couldn.t load|Application error/i.test(text), `platform: ${label} opens`);
  }
  await page.goto(`${BASE}/platform/tenants`);
  const first = await page.locator("main a[href^='/platform/tenants/']").first().getAttribute("href");
  await page.goto(`${BASE}${first}`);
  await page.locator("main h1").first().waitFor();
  check(!/couldn.t load/i.test(await page.locator("body").innerText()), "platform: an agency's page opens");
  check(bag.length === 0, `platform: no script errors ${bag[0] ?? ""}`);
}

// ---- phone width, signed in as the demo agency admin
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(process.env.STAFF_EMAIL ?? "admin@demo.test");
  await page.locator("#password").fill(process.env.STAFF_PASSWORD ?? "Password123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/`).catch(() => {});
  const paths = ["/", "/todo", "/candidates", "/pipeline", "/pipeline?view=list", "/job-orders", "/employers", "/verify", "/follow-up", "/complaints", "/messages", "/finance", "/reports", "/billing", "/settings/general", "/settings/team", "/settings/pipeline", "/candidates/new"];
  for (const p of paths) {
    await page.goto(`${BASE}${p}`);
    await page.locator("main").first().waitFor();
    await page.waitForTimeout(300);
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    check(w.doc <= w.win + 1, `phone: ${p} fits (${w.doc}px of ${w.win}px)`);
  }
  // a candidate page, stage by stage
  await page.goto(`${BASE}/candidates`);
  const href = await page.locator("main a[href^='/candidates/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")).find((h) => /[0-9a-f-]{36}$/.test(h)));
  await page.goto(`${BASE}${href}`);
  await page.locator(".guide").waitFor();
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  check(w.doc <= w.win + 1, `phone: candidate page fits (${w.doc}px of ${w.win}px)`);
  await page.getByRole("button", { name: /menu/i }).first().click().catch(() => {});
}
await browser.close();
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log("\nAll checks passed.");
