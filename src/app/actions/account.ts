"use server";

import { unstable_rethrow } from "next/navigation";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireCan, requireCtx } from "@/lib/session";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { newRecoveryCodes, newSecret, verifyCode } from "@/lib/totp";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";

/** Step 1: create a secret for the authenticator app. It is not active until the first code is confirmed. */
export async function startTotp(_: FormState): Promise<FormState> {
  try {
    const ctx = await requireCtx();
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [u] = await tx`SELECT totp_enabled FROM users WHERE id = ${ctx.userId}`;
        if (u.totp_enabled) throw new Error("Two-step sign-in is already on.");
        await tx`UPDATE users SET totp_secret = ${encrypt(newSecret())} WHERE id = ${ctx.userId}`;
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/account/security");
    return { ok: "Scan the code below" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Step 2: prove the app works by entering a code, then show recovery codes once. */
export async function confirmTotp(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCtx();
    const code = field(fd, "code") ?? "";
    let plain: string[] = [];
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [u] = await tx`SELECT totp_secret, totp_enabled FROM users WHERE id = ${ctx.userId}`;
        if (u.totp_enabled || !u.totp_secret) throw new Error("Start setup first.");
        if (!verifyCode(decrypt(u.totp_secret), code)) throw new Error("That code is not valid. Check the time on your phone and try again.");
        const rc = newRecoveryCodes();
        plain = rc.plain;
        await tx`UPDATE users SET totp_enabled = true, recovery_codes = ${tx.json(rc.hashed as never)} WHERE id = ${ctx.userId}`;
        await audit(tx, ctx, "user.2fa_enabled", "user", ctx.userId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/account/security");
    return { ok: "Two-step sign-in is on. Save these recovery codes now; each works once and they are not shown again.", data: plain, next: steps.totpOn(ctx.role === "employer" ? "/employer" : "/") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function disableTotp(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCtx();
    const password = field(fd, "password") ?? "";
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [t] = await tx`SELECT (settings->>'require_2fa')::boolean AS req FROM tenants WHERE id = ${ctx.tenantId}`;
        if (t?.req) throw new Error("Your agency requires two-step sign-in, so it cannot be turned off.");
        const [u] = await tx`SELECT password_hash FROM users WHERE id = ${ctx.userId}`;
        if (!(await bcrypt.compare(password, u.password_hash))) throw new Error("Incorrect password.");
        await tx`UPDATE users SET totp_enabled = false, totp_secret = NULL, recovery_codes = '[]' WHERE id = ${ctx.userId}`;
        await audit(tx, ctx, "user.2fa_disabled", "user", ctx.userId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/account/security");
    return { ok: "Two-step sign-in is off.", next: steps.totpOff(ctx.role === "employer" ? "/employer" : "/") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function changePassword(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCtx();
    const current = field(fd, "current") ?? "";
    const next = field(fd, "next") ?? "";
    if (next.length < 10) return { error: "The new password needs at least 10 characters." };
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

/** An admin can clear another person's two-step sign-in, for example after a lost phone. */
export async function resetUser2fa(userId: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE users SET totp_enabled = false, totp_secret = NULL, recovery_codes = '[]' WHERE id = ${userId}`;
        await audit(tx, ctx, "user.2fa_reset", "user", userId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/settings", "layout");
    return { ok: "Two-step sign-in cleared", next: steps.twoStepCleared() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
