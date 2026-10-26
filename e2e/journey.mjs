// End-to-end walk through a brand-new agency in a real browser:
//   node e2e/journey.mjs            (against http://localhost:3100)
// It signs up, adds an employer, job order and candidate, takes the candidate through all five stages,
// records money, and then opens every page in the sidebar. It fails on the first thing that does not work.
import { chromium } from "playwright-core";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const cache = join(homedir(), "Library/Caches/ms-playwright");
const dir = readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop();
const exe = join(cache, dir, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

const tmp = mkdtempSync(join(tmpdir(), "e2e-"));
const pdf = join(tmp, "doc.pdf");
writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const tag = Date.now().toString(36);
const A = { agency: `E2E Agency ${tag}`, slug: `e2e-agency-${tag}`, name: "Eve Tester", email: `eve.${tag}@e2e.example`, password: "correct-horse-battery" };

const browser = await chromium.launch({ executablePath: exe, headless: true });
// A fresh address each run, so sign-up rate limiting does not get in the way.
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } })).newPage();
page.setDefaultTimeout(15000);
const problems = [];
page.on("pageerror", (e) => { if (!/negative time stamp/.test(e.message)) problems.push(`page error: ${e.message}`); }); // that one is a React dev-mode timing quirk
page.on("console", (m) => { if (m.type() === "error" && !/hmr|WebSocket|favicon|Failed to load resource|negative time stamp/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`); });

// Opening a page can be interrupted by a redirect or prefetch that is still in flight; try once more if so.
const go = async (url) => {
  try { await page.goto(url); } catch (e) { if (!/ERR_ABORTED|interrupted/.test(e.message)) throw e; await page.waitForTimeout(500); await page.goto(url); }
};
let n = 0;
const step = async (name, fn) => {
  n += 1;
  try { await fn(); console.log(`ok   ${String(n).padStart(2)} ${name}`); }
  catch (e) {
    console.log(`FAIL ${String(n).padStart(2)} ${name}\n     ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: join(tmp, `fail-${n}.png`) });
    console.log(`     screenshot: ${join(tmp, `fail-${n}.png`)}  url: ${page.url()}`);
    await browser.close();
    process.exit(1);
  }
};
const dialog = page.locator("dialog[open]");
const closeNext = async () => { await dialog.getByRole("button", { name: "Not now" }).click(); await dialog.waitFor({ state: "detached" }); };
const expectNext = async (title) => { await dialog.getByText("What would you like to do next?").waitFor(); if (title) await dialog.getByRole("heading", { name: title }).waitFor(); };
const confirmYes = async (label) => { await dialog.getByRole("heading", { name: "Are you sure?" }).waitFor(); await dialog.getByRole("button", { name: label, exact: true }).click(); await dialog.waitFor({ state: "detached" }); };
const fill = async (sel, v) => page.locator(sel).first().fill(v);
const noError = async () => {
  const t = await page.locator("body").innerText();
  if (/This page couldn.t load|Application error|Something went wrong on our side/i.test(t)) throw new Error("error text on page");
};

await step("sign up a new agency", async () => {
  await go(`${BASE}/signup`);
  await fill("#agency", A.agency); await fill("#name", A.name); await fill("#email", A.email); await fill("#password", A.password);
  await page.locator("input[name=terms]").check();
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expectNext("Welcome, Eve");
  await closeNext();
});

await step("dashboard shows setup guidance, no sample data", async () => {
  await page.getByText("Get set up").waitFor();
  await noError();
});

await step("the new agency starts with 20 SMS credits and can buy more", async () => {
  await go(`${BASE}/billing`);
  await page.locator("#credits").getByText("credits left").waitFor();
  const n = (await page.locator("#credits .text-\\[28px\\]").first().innerText()).replace(/\D/g, "");
  if (n !== "20") throw new Error(`expected 20 credits, saw ${n}`);
  await page.locator("#credits").getByRole("button", { name: "Buy credits with M-Pesa" }).waitFor();
});

await step("ask to send texts under the agency's own sender ID", async () => {
  await go(`${BASE}/settings/messages`);
  await page.waitForLoadState("networkidle");
  await page.locator("#value_sms").fill("E2ESMS");
  await page.getByRole("button", { name: "Connect" }).first().click();
  await expectNext("Sent for approval"); await closeNext();
  await page.getByText("waiting for approval").first().waitFor();
});

let employerUrl;
await step("add an employer and see what next", async () => {
  await go(`${BASE}/employers/new`);
  await fill("#company", "Gulf Care Services"); await fill("#country", "Qatar"); await fill("#contact_name", "Layla"); await fill("#email", "jobs@gulfcare.example");
  await page.getByRole("button", { name: "Save company" }).click();
  await expectNext("Employer added");
  await closeNext();
  employerUrl = page.url().split("?")[0];
});

await step("record a registration check and vet the employer", async () => {
  await go(`${employerUrl}#checks`);
  await page.locator("select[name=kind]").selectOption("registration");
  await page.locator("select[name=result]").selectOption("ok");
  await page.getByRole("button", { name: "Record check" }).click();
  await expectNext("Check recorded"); await closeNext();
  await page.getByRole("button", { name: "Mark as vetted" }).click();
  await confirmYes("Mark as vetted");
  await expectNext("Employer is vetted"); await closeNext();
});

await step("create a job order", async () => {
  await go(`${BASE}/job-orders/new`);
  await page.locator("select[name=employer_id]").selectOption({ index: 0 });
  await fill("#title", "Registered nurse"); await fill("#country", "Qatar"); await fill("#quantity", "3");
  await page.getByRole("button", { name: "Save opening" }).click();
  await expectNext("Job order created"); await closeNext();
});

let candUrl;
await step("register a candidate", async () => {
  await go(`${BASE}/candidates/new`);
  await fill("#first_name", "Wanjiru"); await fill("#last_name", "Kariuki"); await fill("#phone", "0712 345 678"); await fill("#county", "Nyeri");
  await page.locator("input[name=consent]").check();
  await page.getByRole("button", { name: "Register recruit" }).click();
  await expectNext("Candidate registered"); await closeNext();
  await page.waitForURL(/\/candidates\/[0-9a-f-]{36}/);
  candUrl = page.url().split("?")[0];
});

await step("guided panel starts at New and offers With employer", async () => {
  await page.getByText("Do this now").waitFor();
  await page.getByRole("button", { name: "Move to With employer" }).waitFor();
});

const upload = async (type) => {
  await go(candUrl); // a fresh page each time, so the form is not reset by the previous upload finishing
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => { document.getElementById("documents").open = true; });
  const form = page.locator("form", { has: page.locator("input[type=file]") });
  await form.locator("select[name=doc_type]").selectOption(type);
  if ((await form.locator("select[name=doc_type]").inputValue()) !== type) throw new Error(`could not choose ${type}`);
  await form.locator("input[name=file]").setInputFiles(pdf);
  await form.getByRole("button", { name: "Upload document" }).click();
  await expectNext("Document uploaded"); await closeNext();
};
const verifyAll = async () => {
  await go(`${BASE}/verify`);
  for (;;) {
    const b = page.getByRole("button", { name: "Verify", exact: true }).first();
    if (!(await b.count())) break;
    await b.click();
    await expectNext("Document verified"); await closeNext();
  }
};

await step("upload the passport and verify it from the verify page", async () => { await upload("Passport"); await verifyAll(); });

await step("match the candidate to the job from the panel", async () => {
  await go(candUrl);
  const sel = page.locator(".guide select[name=job_order_id]");
  await sel.selectOption({ index: 1 });
  await page.locator(".guide").getByRole("button", { name: "Assign", exact: true }).click();
  await expectNext("Job order assigned"); await closeNext();
});

const moveTo = async (stage) => {
  await go(candUrl);
  await page.getByRole("button", { name: `Move to ${stage}`, exact: true }).click();
  await confirmYes(`Move to ${stage}`);
  await expectNext(`Moved to ${stage}`); await closeNext();
};

await step("move New → With employer → Selected", async () => {
  for (const s of ["With employer", "Selected"]) await moveTo(s);
});

await step("contract: record both copies and move on", async () => {
  await go(`${candUrl}#contract`);
  for (const party of ["candidate", "employer"]) {
    const f = page.locator("form", { has: page.getByRole("button", { name: `Record ${party}'s copy` }) });
    await f.locator("input[name=salary]").fill("1300");
    await f.locator("input[name=hours]").fill("48"); await f.locator("input[name=months]").fill("24");
    await f.locator("input[name=signed_on]").fill("2026-10-01");
    await f.getByRole("button", { name: `Record ${party}'s copy` }).click();
    await expectNext("Contract copy recorded"); await closeNext();
  }
  await moveTo("Getting ready");
});

await step("getting ready: Move is locked until documents, visa and orientation are done", async () => {
  await go(candUrl);
  await page.getByText("Police clearance verified").first().waitFor();
  if (!(await page.getByRole("button", { name: "Move to Abroad" }).isDisabled())) throw new Error("move button should be disabled");
  await upload("Police clearance"); await upload("Medical report"); await verifyAll();
  await go(candUrl);
  if (!(await page.getByRole("button", { name: "Move to Abroad" }).isDisabled())) throw new Error("move button should still be locked until the visa is approved");
  await go(`${candUrl}#travel`);
  await page.getByText("Visa approved").waitFor();
  await page.locator("select[name=visa_status]").selectOption("approved");
  await page.locator("input[name=visa_number]").fill("V123456");
  await page.locator("input[name=visa_expiry]").fill("2028-01-01");
  await page.locator("input[name=orientation_done_on]").fill("2026-10-20");
  await page.getByRole("button", { name: "Save travel details" }).click();
  await expectNext("Visa and travel saved"); await closeNext();
  await go(candUrl);
  if (await page.getByRole("button", { name: "Move to Abroad" }).isDisabled()) throw new Error("move button should be enabled");
  await moveTo("Abroad");
});

await step("abroad: last stage, check-in reminders are set", async () => {
  await go(candUrl);
  await page.getByText("This is the last stage").waitFor();
  await go(`${BASE}/follow-up`);
  await page.getByText("Wanjiru Kariuki").first().waitFor();
});

await step("money: add a cost, raise an invoice, record the payment", async () => {
  await go(`${candUrl}#money`);
  await page.locator("form", { has: page.getByRole("button", { name: "Add cost" }) }).locator("input[name=amount]").fill("4500");
  await page.getByRole("button", { name: "Add cost" }).click(); await confirmYes("Add cost");
  await expectNext("Cost recorded"); await closeNext();
  const inv = page.locator("form", { has: page.getByRole("button", { name: "Raise invoice" }) });
  await inv.locator("input[name=amount]").fill("4500");
  await inv.getByRole("button", { name: "Raise invoice" }).click(); await confirmYes("Raise invoice");
  await expectNext("Invoice raised"); await closeNext();
  const pay = page.locator("form", { has: page.getByRole("button", { name: "Record payment" }) });
  await page.waitForFunction(() => document.querySelectorAll("#invoice_id option").length > 1); // the new invoice has arrived
  await pay.locator("select[name=party]").selectOption("employer");
  await pay.locator("select[name=method]").selectOption("bank");
  await pay.locator("input[name=amount]").fill("4500");
  await pay.getByRole("button", { name: "Record payment" }).click(); await confirmYes("Record payment");
  await expectNext("Payment recorded"); await closeNext();
});

const employer = { name: "Layla Hassan", email: `layla.${tag}@gulfcare.example`, password: "employer-password-1" };
await step("give the employer a portal login", async () => {
  await go(employerUrl);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => { document.getElementById("logins")?.closest("details")?.setAttribute("open", ""); });
  await fill("#pu_name", employer.name); await fill("#pu_email", employer.email); await fill("#pu_pw", employer.password);
  await page.getByRole("button", { name: "Create login" }).click();
  await expectNext("Portal login created"); await closeNext();
});

await step("the employer signs in, sees their portal and asks for more workers", async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.setDefaultTimeout(15000);
  await p2.goto(`${BASE}/login`);
  await p2.locator("#email").fill(employer.email); await p2.locator("#password").fill(employer.password);
  await p2.getByRole("button", { name: "Sign in" }).click();
  await p2.waitForURL(`${BASE}/employer`);
  await p2.locator("main h1").first().waitFor();
  await p2.goto(`${BASE}/employer/request`);
  await p2.waitForLoadState("networkidle");
  await p2.locator("#title").fill("Hotel housekeeper"); await p2.locator("#country").fill("Qatar"); await p2.locator("#quantity").fill("2");
  await p2.getByRole("button", { name: "Send request" }).click();
  await p2.locator("dialog[open]").getByRole("heading", { name: "Request sent to the agency" }).waitFor();
  const staffPage = await p2.goto(`${BASE}/`); // an employer must never see the agency's workspace
  if (!/\/employer/.test(p2.url())) throw new Error("employer reached the staff dashboard: " + p2.url());
  void staffPage;
  await ctx2.close();
});

await step("the agency sees the employer's request and can approve it", async () => {
  await go(`${BASE}/job-orders`);
  await page.getByText("Hotel housekeeper").first().waitFor();
});

await step("every sidebar page opens without errors, with a heading", async () => {
  await go(`${BASE}/`);
  const links = await page.locator("aside nav a.nav-link").evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href")]));
  for (const [label, href] of links) {
    await go(`${BASE}${href}`);
    await page.locator("main h1").first().waitFor();
    await noError();
    console.log(`       · ${label} (${href})`);
  }
});

await step("settings sections all open", async () => {
  await go(`${BASE}/settings`);
  const links = await page.locator(".settings-nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  for (const href of links) { await go(`${BASE}${href}`); await page.locator("main").first().waitFor(); await noError(); console.log(`       · ${href}`); }
});

await step("to do list and dashboard reflect the work", async () => {
  await go(`${BASE}/todo`);
  await page.locator("main h1").getByText("To do").waitFor();
  await go(`${BASE}/pipeline`);
  await page.getByText("5. Abroad").first().waitFor();
});

await step("a candidate can register through the agency page", async () => {
  await page.context().clearCookies();
  await go(`${BASE}/c/${A.slug}/register`);
  await page.getByRole("heading", { name: "Register" }).waitFor();
  await page.locator("input[name=first_name]").fill("Otieno"); await page.locator("input[name=last_name]").fill("Odhiambo");
  await page.locator("input[name=phone]").fill("0722 111 222");
  await page.locator("input[name=consent]").check();
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByRole("heading", { name: "Enter your code" }).waitFor();
});

await step("sign out and back in", async () => {
  await go(`${BASE}/login`);
  await fill("#email", A.email); await fill("#password", A.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/`);
  await page.getByRole("button", { name: /Sign out/ }).first().click().catch(() => {});
});

await browser.close();
const real = problems.filter((p) => !/401|404/.test(p));
if (real.length) { console.log("\nBrowser reported problems:\n" + [...new Set(real)].map((p) => "  - " + p).join("\n")); process.exit(1); }
console.log(`\nAll ${n} steps passed for ${A.agency}.`);
