import { notFound, redirect } from "next/navigation";
import { isSingleInstall } from "@/lib/plan";
import { getPlatformAdmin } from "@/lib/platform";
import { ActionForm } from "@/components/ActionForm";
import { platformLogin } from "@/app/actions/platform";

export default async function PlatformLogin() {
  if (isSingleInstall()) notFound();
  if (await getPlatformAdmin()) redirect("/platform");
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="card w-full max-w-sm grid gap-3">
        <div><h1 className="h1">Platform sign-in</h1><p className="muted">For the people who run the service. Agencies sign in elsewhere.</p></div>
        <ActionForm action={platformLogin} submit="Continue" resetOnSuccess={false}>
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required className="input" /></div>
          <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required className="input" /></div>
        </ActionForm>
      </div>
    </main>
  );
}
