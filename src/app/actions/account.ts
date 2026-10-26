"use server";

import { unstable_rethrow } from "next/navigation";
import bcrypt from "bcryptjs";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { audit } from "@/lib/audit";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";

export async function changePassword(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCtx();
    const current = field(fd, "current") ?? "";
    const next = field(fd, "next") ?? "";
    if (next.length < 8) return { error: "The new password needs at least 8 characters." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [u] = await tx`SELECT password_hash FROM users WHERE id = ${ctx.userId}`;
        if (!(await bcrypt.compare(current, u.password_hash))) throw new Error("Your current password is not right.");
        await tx`UPDATE users SET password_hash = ${await bcrypt.hash(next, 10)} WHERE id = ${ctx.userId}`;
        await audit(tx, ctx, "user.password_changed", "user", ctx.userId);
      });
    } catch (e) {
      return fail(e);
    }
    return { ok: "Password changed", next: steps.passwordChanged(ctx.role === "employer" ? "/employer" : "/") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
