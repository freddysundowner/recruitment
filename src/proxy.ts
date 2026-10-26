import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic check only: send visitors without a session cookie to the sign-in page.
// Every page and action still verifies the session against the database.
const PUBLIC = ["/login", "/api/", "/c/", "/signup", "/setup", "/welcome", "/guide", "/sitemap.xml", "/robots.txt", "/icon", "/apple-icon", "/pwa-icon", "/manifest.webmanifest", "/platform", "/_next", "/favicon.ico"];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // An agency's own address, such as acme.yourapp.co.ke, opens that agency's candidate pages.
  const domain = process.env.APP_DOMAIN;
  const host = request.headers.get("host")?.split(":")[0];
  if (domain && host && host.endsWith(`.${domain}`) && path === "/") {
    const sub = host.slice(0, -(domain.length + 1));
    if (!["www", "app"].includes(sub) && /^[a-z0-9-]+$/.test(sub)) return NextResponse.rewrite(new URL(`/c/${sub}`, request.url));
  }
  if (PUBLIC.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))) return;
  if (!request.cookies.has("session")) {
    // Visitors to the front door see the product page; a single-agency install goes straight to sign-in.
    if (path === "/" && process.env.TENANT_MODE !== "single") return NextResponse.rewrite(new URL("/welcome", request.url));
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
