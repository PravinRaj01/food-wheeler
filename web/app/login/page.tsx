"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";
import { login, signup, loginWithGoogle } from "@/app/auth/actions";

function errorMessageForCode(code: string | null): string | null {
  if (!code) return null;
  // Auth.js sends failures back as /login?error=<code> (lib/auth.config.ts pages.error).
  return code === "OAuthAccountNotLinked"
    ? "That email is already registered with a password. Log in with your email and password instead."
    : "Sign-in failed. Please try again.";
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  // Lazy initializer reads the URL once at mount - no effect needed, and no
  // "set state during render" issue since this runs during useState's own
  // initialization, not as a side effect afterward.
  const [error, setError] = useState<string | null>(() => errorMessageForCode(searchParams.get("error")));
  // Controlled so React 19's automatic form reset (which runs after every
  // form action) doesn't wipe the email after a failed attempt.
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const action = isLogin ? login : signup;
    const result = await action(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="glass w-full max-w-sm rounded-3xl p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="h-10 w-10" />
          <h1 className="font-display text-2xl font-semibold text-cream">
            {isLogin ? "Welcome back" : "Join Food Wheeler"}
          </h1>
          <p className="text-sm text-cream/50">
            {isLogin ? "Log in to sync your decision history" : "Create an account to save your history"}
          </p>
        </div>

        <form action={loginWithGoogle}>
          <button
            type="submit"
            className="mb-4 w-full rounded-xl border border-line bg-glass py-3 text-sm font-medium text-cream transition-colors hover:bg-glass-strong"
          >
            Continue with Google
          </button>
        </form>

        <div className="mb-4 flex items-center gap-3 text-xs text-cream/30">
          <div className="h-px flex-1 bg-line" />
          or
          <div className="h-px flex-1 bg-line" />
        </div>

        <form action={handleSubmit} className="space-y-3">
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line bg-glass px-4 py-3 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          />
          {!isLogin && (
            <input
              name="name"
              type="text"
              placeholder="Name (optional)"
              className="w-full rounded-xl border border-line bg-glass px-4 py-3 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
            />
          )}
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="w-full rounded-xl border border-line bg-glass px-4 py-3 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          />

          {error && <p className="text-xs text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-ember py-3 text-sm font-medium text-ink transition-opacity disabled:opacity-50"
          >
            {loading ? "…" : isLogin ? "Log in" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-cream/40">
          {isLogin ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="text-cream/70 underline"
          >
            {isLogin ? "Create an account" : "Log in"}
          </button>
        </p>
      </div>

      <Link href="/decide" className="mt-6 text-xs text-cream/40 underline">
        Continue as a guest
      </Link>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
