import Link from "next/link";
import { Suspense } from "react";
import { NextStepHost } from "@/components/NextStepHost";
import { requireCtx } from "@/lib/session";

export default async function AccountLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireCtx();
  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 grid gap-4">
      <div className="flex items-center justify-between">
        <span className="font-bold">Recruitment System</span>
        <Link className="link" href={ctx.role === "employer" ? "/employer" : "/"}>Back to the app</Link>
      </div>
      <Suspense><NextStepHost /></Suspense>
      {children}
    </div>
  );
}
