// A company, an opening with requirements, and a recruit who has to meet them before being put forward.
//   node e2e/openings.mjs     (against http://localhost:3100)
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const cache = join(homedir(), "Library/Caches/ms-playwright");
const dir = readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop();
const exe = join(cache, dir, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const tag = Date.now().toString(36);

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
page.setDefaultTimeout(15000);
const dialog = page.locator("dialog[open]");
const next = async () => { await dialog.getByText("What would you like to do next?").waitFor(); await dialog.getByRole("button", { name: "Not now" }).click(); await dialog.waitFor({ state: "detached" }); };
const go = async (u) => { try { await page.goto(u); } catch { await page.waitForTimeout(500); await page.goto(u); } await page.waitForLoadState("networkidle"); };
let n = 0;
const step = async (name, fn) => {
  n += 1;
  try { await fn(); console.log(`ok   ${n} ${name}`); } catch (e) { console.log(`FAIL ${n} ${name}\n     ${e.message.split("\n")[0]}\n     url: ${page.url()}`); await page.screenshot({ path: "/private/tmp/claude-501/openings-fail.png" }); await browser.close(); process.exit(1); }
};
let openingUrl, recruitUrl;

await step("sign up and add a company", async () => {
  await go(`${BASE}/signup`);
  await page.fill("#agency", `Openings Agency ${tag}`); await page.fill("#name", "Ola Tester"); await page.fill("#email", `ola.${tag}@e2e.example`); await page.fill("#password", "correct-horse-battery");
  await page.locator("input[name=terms]").check(); await page.getByRole("button", { name: "Create my workspace" }).click(); await next();
  await go(`${BASE}/employers/new`);
  await page.fill("#company", "Gulf Care Services"); await page.fill("#country", "Qatar");
  await page.getByRole("button", { name: "Save company" }).click(); await next();
});

await step("add an opening that asks for age, experience and a licence", async () => {
  await go(`${BASE}/job-orders/new`);
  await page.fill("#title", "Registered nurse"); await page.fill("#country", "Qatar"); await page.fill("#quantity", "2");
  await page.fill("#min_age", "25"); await page.fill("#max_age", "40"); await page.selectOption("#gender", "Female"); await page.fill("#min_experience_years", "2");
  await page.fill("#other_requirements", "Nursing licence");
  await page.getByRole("button", { name: "Save opening" }).click(); await next();
  await page.getByText("Documents checked: Passport, Police clearance, Medical report").waitFor();
  await page.getByText("Age 25 to 40").waitFor(); await page.getByText("Nursing licence").first().waitFor();
  openingUrl = page.url().split("?")[0];
});

await step("a recruit is added, and the opening shows what they are missing", async () => {
  await go(`${BASE}/candidates/new`);
  await page.fill("#first_name", "Wanjiru"); await page.fill("#last_name", "Kariuki"); await page.fill("#phone", "0712 345 678");
  await page.locator("input[name=consent]").check(); await page.getByRole("button", { name: "Register recruit" }).click(); await next();
  await page.waitForURL(/\/candidates\/[0-9a-f-]{36}/); recruitUrl = page.url().split("?")[0];
  await go(openingUrl);
  const row = page.locator("tr", { hasText: "Wanjiru Kariuki" });
  await row.getByText("add their date of birth").waitFor();
});

await step("assign the recruit from the opening, and see the checklist", async () => {
  await page.locator("tr", { hasText: "Wanjiru Kariuki" }).getByRole("button", { name: "Assign" }).click(); await next();
  await go(openingUrl);
  await page.locator("tr", { hasText: "Wanjiru Kariuki" }).getByText(/0 of \d/).waitFor();
  await go(recruitUrl);
  await page.getByText("What Registered nurse needs").waitFor();
  if (!(await page.getByRole("button", { name: "Move to With employer" }).isDisabled())) throw new Error("the move should be locked until the recruit meets the opening: " + (await page.locator(".guide").innerText()).replace(/\n+/g, " | "));
});

await step("fill in the missing facts and tick the licence; the move unlocks", async () => {
  await page.evaluate(() => { document.getElementById("profile").open = true; });
  await page.fill("#dob", "1992-03-04"); await page.selectOption("#gender", "Female"); await page.fill("#experience_years", "4");
  await page.locator("#profile").getByRole("button", { name: "Save changes" }).click(); await next();
  await go(recruitUrl);
  await page.locator(".guide li", { hasText: "Nursing licence" }).getByRole("button", { name: "Mark as met" }).click();
  await page.locator(".guide li.done", { hasText: "Nursing licence" }).waitFor();
  await go(recruitUrl);
  if (await page.getByRole("button", { name: "Move to With employer" }).isDisabled()) throw new Error("the move should now be open");
  await page.getByRole("button", { name: "Move to With employer", exact: true }).click();
  await dialog.getByRole("button", { name: "Move to With employer", exact: true }).click(); await next();
});

await browser.close();
console.log(`\nAll ${n} steps passed.`);
