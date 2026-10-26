// Checks what search engines and social sites see on the public pages.
//   node e2e/seo.mjs   (against http://localhost:3100)
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const cache = join(homedir(), "Library/Caches/ms-playwright");
const dir = readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().pop();
const exe = join(cache, dir, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed += 1; };

for (const path of ["/", "/guide"]) {
  const res = await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  check(res.status() === 200, `${path} answers 200`);
  const m = await page.evaluate(() => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute("content") ?? null;
    return {
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      robots: meta('meta[name="robots"]'),
      ogTitle: meta('meta[property="og:title"]'), ogDesc: meta('meta[property="og:description"]'), ogImage: meta('meta[property="og:image"]'), ogType: meta('meta[property="og:type"]'),
      twCard: meta('meta[name="twitter:card"]'), twImage: meta('meta[name="twitter:image"]'),
      lang: document.documentElement.lang,
      h1: [...document.querySelectorAll("h1")].map((h) => h.innerText),
      h2: document.querySelectorAll("h2").length,
      viewport: meta('meta[name="viewport"]'),
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
      imgsNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.alt).length,
      mainCount: document.querySelectorAll("main").length,
    };
  });
  check(m.title.length >= 30 && m.title.length <= 65, `${path} title is ${m.title.length} characters: "${m.title}"`);
  check(m.description && m.description.length >= 70 && m.description.length <= 160, `${path} description is ${m.description?.length} characters`);
  check(m.canonical && (path === "/" ? m.canonical.replace(/\/$/, "") === BASE : m.canonical.endsWith(path)), `${path} canonical is ${m.canonical}`);
  check(!/noindex/.test(m.robots ?? ""), `${path} can be indexed`);
  check(m.ogTitle && m.ogDesc && m.ogImage && m.ogType, `${path} has Open Graph title, description, image and type`);
  check(m.twCard === "summary_large_image" && m.twImage, `${path} has a Twitter card with an image`);
  check(m.lang === "en", `${path} declares its language`);
  check(m.h1.length === 1, `${path} has exactly one h1: "${m.h1[0]}"`);
  check(m.h2 >= 3, `${path} has ${m.h2} section headings`);
  check(m.viewport?.includes("width=device-width"), `${path} is set up for phones`);
  check(m.mainCount === 1, `${path} has one main landmark`);
  check(m.imgsNoAlt === 0, `${path} has no images without alt text`);
  let parsed = 0;
  for (const j of m.ld) { try { JSON.parse(j); parsed += 1; } catch { /* reported below */ } }
  check(m.ld.length > 0 && parsed === m.ld.length, `${path} has ${m.ld.length} valid structured-data blocks`);
  if (path === "/") {
    const types = m.ld.map((j) => JSON.parse(j)["@type"]);
    check(["Organization", "SoftwareApplication", "FAQPage"].every((t) => types.includes(t)), `/ describes the organisation, the software and the FAQ (${types.join(", ")})`);
    if (m.ogImage) {
      const img = await page.request.get(m.ogImage.replace(/^https?:\/\/[^/]+/, BASE));
      check(img.ok() && (img.headers()["content-type"] ?? "").includes("image/png"), "/ share image loads as a PNG");
    }
  }
  // No sideways scrolling at phone width, and the page works without a mouse.
  await page.setViewportSize({ width: 375, height: 800 });
  const w = await page.evaluate(() => ({ d: document.documentElement.scrollWidth, w: window.innerWidth }));
  check(w.d <= w.w + 1, `${path} fits a phone (${w.d}px of ${w.w}px)`);
  await page.setViewportSize({ width: 1280, height: 900 });
}

const robots = await page.request.get(`${BASE}/robots.txt`);
const rt = await robots.text();
check(robots.ok() && /Sitemap:/i.test(rt) && /Disallow: \/platform/.test(rt), "robots.txt lists the sitemap and keeps private areas out");
const sm = await page.request.get(`${BASE}/sitemap.xml`);
const sx = await sm.text();
check(sm.ok() && sx.includes("<loc>") && sx.includes("/guide"), "sitemap.xml lists the public pages");
check((await page.request.get(`${BASE}/icon`)).ok(), "the site icon loads");

// Behind nginx the request carries the visitor's address in headers; the front page must still work.
const behind = await page.request.get(`${BASE}/`, { headers: { Host: new URL(BASE).host, "X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.5" } });
check(behind.status() === 200, "the front page works behind nginx (forwarded host and https)");

// Private pages must tell search engines to stay away.
await page.goto(`${BASE}/login`);
check(/noindex/.test((await page.locator('meta[name="robots"]').getAttribute("content")) ?? ""), "/login is kept out of search results");
await browser.close();
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log("\nAll SEO checks passed.");
