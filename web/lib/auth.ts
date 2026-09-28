import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { getDb } from "./db/client";
import { accounts, users } from "./db/schema";
import { burnVerifyTime, verifyPassword } from "./auth/password";

const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(1).max(128),
});

// Passed as a FUNCTION so getDb() runs per request rather than at import
// time - the same "never build a DB client at module scope" rule as
// lib/db/client.ts.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const db = getDb();

  return {
    ...authConfig,
    // Only users + accounts exist in our schema. Sessions/verification
    // tables are for database sessions, which we deliberately don't use.
    adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts }),
    providers: [
      // Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the environment. If
      // they're unset, Auth.js simply won't offer this provider - no crash,
      // the Google button just needs those two env vars to appear/work.
      Google,
      Credentials({
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const { email, password } = parsed.data;

          const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

          // Unknown email, or a Google-only user with no password: still
          // spend the same time as a real check so timing doesn't reveal
          // which emails are registered.
          if (!user?.passwordHash) {
            await burnVerifyTime(password);
            return null;
          }

          const ok = await verifyPassword(user.passwordHash, password);
          if (!ok) return null;

          return { id: user.id, email: user.email, name: user.name, image: user.image };
        },
      }),
    ],
  };
});
