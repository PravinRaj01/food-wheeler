"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

// Same return contract the login page uses: `{ error }` on failure, a
// redirect on success. redirect() must stay OUTSIDE try/catch - it works by
// throwing, and a catch would swallow it.

const loginSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
  password: z.string().min(1, "Enter your password").max(128),
});

const signupSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
  // Length, not composition rules: long passphrases beat "P@ssw0rd!" and
  // argon2id is what protects a leaked hash.
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name: z.string().trim().max(80).optional(),
});

function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

export async function login(formData: FormData): Promise<{ error: string } | undefined> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  try {
    await signIn("credentials", { ...parsed.data, redirect: false });
  } catch (e) {
    // One message for every credential failure - never say which half was wrong.
    if (e instanceof AuthError) return { error: "Invalid email or password" };
    throw e;
  }
  redirect("/decide");
}

export async function signup(formData: FormData): Promise<{ error: string } | undefined> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") || undefined,
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { email, password, name } = parsed.data;

  const passwordHash = await hashPassword(password);

  // onConflictDoNothing makes "email already taken" atomic - no
  // check-then-insert race between two simultaneous signups.
  const inserted = await getDb()
    .insert(users)
    .values({ email, name: name ?? null, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  if (inserted.length === 0) {
    return { error: "An account with this email already exists. Try logging in instead." };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Account created, but sign-in failed. Please log in." };
    throw e;
  }
  redirect("/decide");
}

/** Used as a <form action>. signIn() throws a redirect to Google's consent screen. */
export async function loginWithGoogle() {
  await signIn("google", { redirectTo: "/decide" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
