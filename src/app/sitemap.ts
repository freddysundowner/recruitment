import type { MetadataRoute } from "next";
import { isSingleInstall } from "@/lib/plan";
import { siteUrl } from "@/lib/site";

// Only the public pages. A single-agency install is private, so it lists nothing.
export default function sitemap(): MetadataRoute.Sitemap {
  if (isSingleInstall()) return [];
  const base = siteUrl();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/guide`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];
}
