import { redirect } from "next/navigation";
import { readPlatformPending } from "@/lib/platform";
import { ActionForm } from "@/components/ActionForm";
import { platformVerify } from "@/app/actions/platform";

export default async function PlatformVerify() {
  if (!(await readPlatformPending())) redirect("/platform/login");
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="card w-full max-w-sm grid gap-3">
        <h1 className="h1">Two-step sign-in</h1>
        <p className="muted">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
        <ActionForm action={platformVerify} submit="Verify" resetOnSuccess={false}>
          <div><label className="label" htmlFor="code">Code</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="input" /></div>
        </ActionForm>
      </div>
    </main>
  );
}
