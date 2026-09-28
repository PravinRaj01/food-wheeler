"use server";

import { getUserIdOrNull } from "@/lib/auth/session";

/** Lets a client component learn the current user id without pulling in
 * next-auth/react's SessionProvider just for this one read. */
export async function getCurrentUserId(): Promise<string | null> {
  return getUserIdOrNull();
}
