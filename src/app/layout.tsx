import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { NavProgress } from "@/components/NavProgress";
import { SITE, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE.name}: ${SITE.tagline}`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: { type: "website", siteName: SITE.name, locale: "en_KE" },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: "Recruitment", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#0f6b5c", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full"><Suspense><NavProgress /></Suspense>{children}</body>
    </html>
  );
}
