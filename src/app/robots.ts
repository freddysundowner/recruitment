import type { MetadataRoute } from "next";
import { isSingleInstall } from "@/lib/plan";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  if (isSingleInstall()) return { rules: { userAgent: "*", disallow: "/" } };
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: ["/", "/guide", "/signup"], disallow: ["/platform", "/api/", "/files/", "/export/", "/employer", "/account", "/setup", "/c/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
