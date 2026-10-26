import { ogImage, ogSize } from "@/lib/og";

export const alt = "How to use Recruitment Workspace: a simple step-by-step guide";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("How to use Recruitment Workspace", "A simple step-by-step guide for agency staff.");
}
