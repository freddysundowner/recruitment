import { ImageResponse } from "next/og";

// The home-screen icon at the sizes phones ask for. "maskable" leaves a safe margin so round and rounded-square masks do not cut the letter off.
export async function GET(req: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await ctx.params;
  const px = size === "512" ? 512 : size === "180" ? 180 : 192;
  const maskable = new URL(req.url).searchParams.has("maskable");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f6b5c", color: "white" }}>
        <div style={{ display: "flex", fontSize: px * (maskable ? 0.5 : 0.62), fontWeight: 800, lineHeight: 1 }}>R</div>
      </div>
    ),
    { width: px, height: px },
  );
}
