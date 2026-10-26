import { redirect } from "next/navigation";
import { readPendingMfa } from "@/lib/session";
import { VerifyForm } from "./form";

export default async function VerifyPage() {
  if (!(await readPendingMfa())) redirect("/login");
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="card w-full max-w-sm">
        <h1 className="h1">Two-step sign-in</h1>
        <p className="muted mt-1 mb-4">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
        <VerifyForm />
      </div>
    </main>
  );
}
