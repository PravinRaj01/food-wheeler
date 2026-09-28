import type { DefaultSession } from "next-auth";

// session.user.id is always present once signed in: lib/auth.config.ts copies
// it from the JWT's `sub`. Every server-side query is scoped with it.
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
