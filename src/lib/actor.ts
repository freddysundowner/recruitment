import type { Role } from "./perms";

/** Who is doing something. Pure data, so the worker and tests can use it without Next.js. */
export type Actor = { userId: string; tenantId: string; role: Role };
