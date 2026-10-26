import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only the Docker image runs the small standalone server; a normal install uses `next start`.
  output: process.env.STANDALONE === "1" ? "standalone" : undefined,
  devIndicators: false,
  // Lets a second copy run side by side while testing (for example a single-install trial).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
