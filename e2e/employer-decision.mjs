// An employer reviews a candidate put forward to them: asks for an interview, then selects them.
//   node e2e/employer-decision.mjs     (against http://localhost:3100)
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const cache = join(homedir(), "Library/Caches/ms-playwright");
const dir = readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop();
const exe = join(cache, dir, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const tag = Date.now().toString(36);
const A = { agency: `Decide Agency ${tag}`, name: "Dee Tester", email: `dee.${tag}@e2e.example`, password: "correct-horse-battery" };
const E = { name: "Eli Employer", email: `eli.${tag}@e2e.example`, password: "employer-password-1" };

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
page.setDefaultTimeout(15000);
const dialog = page.locator("dialog[open]");
const closeNext = async () => { await dialog.getByRole("button", { name: "Not now" }).click(); await dialog.waitFor({ state: "detached" }); };
const go = async (u) => { try { await page.goto(u); } catch { await page.waitForTimeout(500); await page.goto(u); } await page.waitForLoadState("networkidle"); };
let n = 0;
const step = async (name, fn) => {
  n += 1;
  try { await fn(); console.log(`ok   ${n} ${name}`); } catch (e) { console.log(`FAIL ${n} ${name}\n     ${e.message.split("\n")[0]}\n     url: ${page.url()}`); await browser.close(); process.exit(1); }
};

await step("set up an agency with a vetted employer, a job and a candidate put forward", async () => {
  await go(`${BASE}/signup`);
  await page.fill("#agency", A.agency); await page.fill("#name", A.name); await page.fill("#email", A.email); await page.fill("#password", A.password);
  await page.locator("input[name=terms]").check(); await page.getByRole("button", { name: "Create my workspace" }).click();
  await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  await go(`${BASE}/employers/new`);
  await page.fill("#company", "Decide Co"); await page.fill("#country", "Qatar"); await page.fill("#contact_name", "Eli");
  await page.getByRole("button", { name: "Save company" }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  const employerUrl = page.url().split("?")[0];
  await go(`${employerUrl}#checks`);
  await page.locator("select[name=kind]").selectOption("registration"); await page.locator("select[name=result]").selectOption("ok");
  await page.getByRole("button", { name: "Record check" }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  await page.getByRole("button", { name: "Mark as vetted" }).click(); await dialog.getByRole("button", { name: "Mark as vetted", exact: true }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  await go(employerUrl); await page.evaluate(() => document.getElementById("logins")?.closest("details")?.setAttribute("open", ""));
  await page.fill("#pu_name", E.name); await page.fill("#pu_email", E.email); await page.fill("#pu_pw", E.password);
  await page.getByRole("button", { name: "Create login" }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  await go(`${BASE}/job-orders/new`);
  await page.locator("select[name=employer_id]").selectOption({ index: 0 }); await page.fill("#title", "Cook"); await page.fill("#country", "Qatar"); await page.fill("#quantity", "2");
  await page.getByRole("button", { name: "Save opening" }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  await go(`${BASE}/candidates/new`);
  await page.fill("#first_name", "Amani"); await page.fill("#last_name", "Mutiso"); await page.fill("#phone", "0711 222 333"); await page.locator("input[name=consent]").check();
  await page.getByRole("button", { name: "Register recruit" }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  await page.waitForURL(/\/candidates\/[0-9a-f-]{36}/); await page.waitForLoadState("networkidle");
  await page.locator(".guide select[name=job_order_id]").selectOption({ index: 1 });
  await page.locator(".guide").getByRole("button", { name: "Assign", exact: true }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
  await page.getByRole("button", { name: "Move to With employer", exact: true }).click();
  await dialog.getByRole("button", { name: "Move to With employer", exact: true }).click(); await dialog.getByText("What would you like to do next?").waitFor(); await closeNext();
});

await step("the employer sees the candidate and asks for an interview", async () => {
  await page.context().clearCookies(); await go(`${BASE}/login`);
  await page.fill("#email", E.email); await page.fill("#password", E.password); await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/employer`); await page.getByText("Cook").first().click(); await page.waitForLoadState("networkidle");
  await page.getByText("Amani Mutiso").waitFor();
  await page.getByText("Waiting for your decision").first().waitFor();
  const t = new Date(Date.now() + 3 * 86400000); const pad = (x) => String(x).padStart(2, "0");
  await page.locator("input[name=scheduled_at]").fill(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T10:00`);
  await page.getByRole("button", { name: "Request interview" }).click(); await dialog.getByRole("button", { name: "Request interview", exact: true }).click();
  await dialog.getByText("Interview requested").or(dialog.getByRole("heading")).first().waitFor();
  await page.waitForTimeout(500);
});

await step("the employer selects the candidate, who is then Selected", async () => {
  await go(page.url().split("?")[0]);
  await page.getByRole("button", { name: "Select this candidate" }).click(); await dialog.getByRole("button", { name: "Select this candidate", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.context().clearCookies(); await go(`${BASE}/login`);
  await page.fill("#email", A.email); await page.fill("#password", A.password); await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/`); await go(`${BASE}/pipeline`);
  const col = page.locator("section, div").filter({ hasText: /3\. Selected/ }).first();
  await col.getByText("Mutiso").first().waitFor();
});

await browser.close();
console.log(`\nAll ${n} steps passed.`);
