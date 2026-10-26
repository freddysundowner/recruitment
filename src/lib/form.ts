import type { Step } from "./next-steps";

export type FormState = {
  error?: string;
  ok?: string;
  /** Lines shown once after success, such as recovery codes. */
  data?: string[];
  /** Suggested next moves, shown in a dialog. */
  next?: Step;
} | undefined;

/** Reads a form field as trimmed text, or null when empty. */
export function field(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Turns anything thrown inside an action into a message for the form. Errors written for people (plain `Error`s)
 * are shown as they are; database errors are mapped to a friendly line or a generic one, so internal details
 * such as table names never reach the screen. The real error is logged on the server.
 */
export function fail(e: unknown): { error: string } {
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    if (e.name === "PostgresError" || (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code))) {
      console.error("database error:", e.message);
      if (code === "23505") return { error: "That record already exists." };
      if (code === "23503") return { error: "That record is in use or does not exist." };
      if (code === "42501") return { error: "You do not have permission to do that." };
      return { error: "Something went wrong on our side. Please try again, and contact support if it keeps happening." };
    }
    return { error: e.message };
  }
  console.error("unexpected error:", e);
  return { error: "Something went wrong." };
}
