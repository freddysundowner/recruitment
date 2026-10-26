import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic check only: send visitors without a session cookie to the sign-in page.
// Every page and action still verifies the session against the database.
const PUBLIC = ["/login", "/api/", "/c/", "/signup", "/setup", "/welcome", "/guide", "/sitemap.xml", "/robots.txt", "/icon", "/apple-icon", "/pwa-icon", "/manifest.webmanifest", "/platform", "/_next", "/favicon.ico"];

// Behind nginx, the address Next.js builds for itself can differ from the one the visitor typed (it may say
// https://localhost:3100). So rewrites and redirects are built from the headers the visitor's request really carried.
function publicOrigin(request: NextRequest) {
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host).split(",")[0].trim();
  return `${proto}://${host}`;
}
const rewriteTo = (request: NextRequest, pathname: string) => NextResponse.rewrite(new URL(pathname + request.nextUrl.search, publicOrigin(request)));
const redirectTo = (request: NextRequest, pathname: string) => NextResponse.redirect(new URL(pathname, publicOrigin(request)));

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // An agency's own address, such as acme.yourapp.co.ke, opens that agency's candidate pages.
  const domain = process.env.APP_DOMAIN;
  const host = request.headers.get("host")?.split(":")[0];
  if (domain && host && host.endsWith(`.${domain}`) && path === "/") {
    const sub = host.slice(0, -(domain.length + 1));
    if (!["www", "app"].includes(sub) && /^[a-z0-9-]+$/.test(sub)) return rewriteTo(request, `/c/${sub}`);
  }
  if (PUBLIC.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))) return;
  if (!request.cookies.has("session")) {
    // Visitors to the front door see the product page; a single-agency install goes straight to sign-in.
    if (path === "/" && process.env.TENANT_MODE !== "single") return rewriteTo(request, "/welcome");
    return redirectTo(request, "/login");
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
