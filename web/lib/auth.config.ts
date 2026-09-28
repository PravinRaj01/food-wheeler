import type { NextAuthConfig } from "next-auth";

// Edge-safe half of the Auth.js config. middleware.ts imports THIS, not
// lib/auth.ts - the full config pulls in the DB adapter and the native
// argon2 binding, neither of which can load on the edge runtime. With JWT
// sessions, middleware only ever needs to decode the signed cookie, so it
// needs no provider, no adapter and no database. That is what keeps Neon's
// scale-to-zero cold start off the auth path entirely.

export const authConfig = {
  // Unauthenticated users hitting a protected route land on the login page,
  // and Auth.js errors (e.g. OAuthAccountNotLinked) come back as /login?error=...
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  providers: [], // real providers are added in lib/auth.ts
  callbacks: {
    // Decide and Explore are open to guests (the whole point of the app is
    // trying it with zero friction); History requires a login since it's
    // tied to a saved account.
    authorized({ auth, request: { nextUrl } }) {
      const path = nextUrl.pathname;
      const loggedIn = !!auth?.user;
      if (path.startsWith("/history")) return loggedIn;
      return true;
    },
    // Copy the user id into the token, then onto the session, so server code
    // can scope every query with session.user.id.
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
