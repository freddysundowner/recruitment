import type { Metadata } from "next";
import { Suspense } from "react";
import { NavProgress } from "@/components/NavProgress";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recruitment Agency System",
  description: "Run an overseas recruitment agency from registration to deployment.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full"><Suspense><NavProgress /></Suspense>{children}</body>
    </html>
  );
}
