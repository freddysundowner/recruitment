/** What the product is called and where it lives, used by the marketing pages, the sitemap and the share image. */
export const SITE = {
  name: "Recruitment Workspace",
  tagline: "Software for overseas recruitment agencies",
  description:
    "Run an overseas recruitment agency from first registration to a worker settled abroad: candidates, documents, employers, contracts, visas, M-Pesa and SMS follow-up in one place.",
};

/** The public address of the site, with no trailing slash. Set APP_URL in production so links and the sitemap are right. */
export const siteUrl = () => (process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "");

/** JSON for a `<script type="application/ld+json">` tag, safe to put in a page. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
