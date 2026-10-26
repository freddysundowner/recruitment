import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Lets people add the system to their phone's home screen, where it opens full screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: "Recruitment",
    description: SITE.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f4f6",
    theme_color: "#0f6b5c",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
