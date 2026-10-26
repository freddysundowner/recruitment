import { ImageResponse } from "next/og";
import { SITE } from "./site";

export const ogSize = { width: 1200, height: 630 };

/** The picture shown when the site is shared on WhatsApp, Facebook, LinkedIn and X. */
export function ogImage(headline: string, sub: string) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #0f6b5c 0%, #0a4a40 100%)", color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, fontWeight: 700 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "white", color: "#0f6b5c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34 }}>R</div>
          {SITE.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 70, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2 }}>{headline}</div>
          <div style={{ fontSize: 32, opacity: 0.85, lineHeight: 1.3 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 26 }}>
          {["Candidates", "Documents", "Employers", "M-Pesa", "SMS follow-up"].map((t) => (
            <div key={t} style={{ padding: "8px 20px", borderRadius: 999, background: "rgba(255,255,255,0.16)" }}>{t}</div>
          ))}
        </div>
      </div>
    ),
    ogSize,
  );
}
