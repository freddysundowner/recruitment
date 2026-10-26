import { ogImage, ogSize } from "@/lib/og";

export const alt = "Recruitment Workspace: software for overseas recruitment agencies";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Run your whole agency in one place", "From first registration to a worker settled abroad.");
}
