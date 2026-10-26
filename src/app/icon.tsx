import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f6b5c", color: "white", fontSize: 42, fontWeight: 800, borderRadius: 14 }}>R</div>,
    size,
  );
}
