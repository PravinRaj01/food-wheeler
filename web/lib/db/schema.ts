import { index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { Candidate, EngineId, Tiebreaker } from "@/lib/decide/types";

// Single source of truth for the database. Two groups of tables, same split
// as the Bill-a project this was ported from:
//
// 1. Auth.js tables (users, accounts) — only these two, because we use JWT
//    sessions. @auth/drizzle-adapter requires just usersTable + accountsTable;
//    sessions/verificationTokens/authenticators are optional and only used by
//    database sessions. Skipping them means no session lookup on the auth
//    path, which matters because Neon's free tier scales to zero after 5
//    minutes idle and that can't be turned off.
//
// 2. App tables (decisions, preferences). EVERY query against these must
//    filter on user_id from the verified server-side session, never from a
//    client-supplied value — that rule replaces row-level security here.
//    It lives in lib/db/queries.ts and lib/actions/*, not in the schema.

// --- Auth.js -----------------------------------------------------------------

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // Null for Google-only users. Argon2id hash for email+password users.
  passwordHash: text("password_hash"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    // Column names below are fixed by the Auth.js adapter contract.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (a) => [primaryKey({ columns: [a.provider, a.providerAccountId] })],
);

// --- App tables ----------------------------------------------------------------

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Generated on the client for the outbox, unique PER USER (not
    // globally) - see lib/sync/outbox.ts. pushOutbox upserts on
    // (user_id, client_id), so a retry never creates a duplicate row.
    clientId: uuid("client_id").notNull(),
    partner1Text: text("partner1_text").notNull(),
    partner2Text: text("partner2_text").notNull(),
    engine: text("engine").$type<EngineId>().notNull(),
    confidence: real("confidence").notNull(),
    reason: text("reason").notNull(),
    radiusKm: real("radius_km").notNull(),
    source: text("source").notNull(),
    winner: jsonb("winner").$type<Candidate>().notNull(),
    runnerUps: jsonb("runner_ups").$type<{ id: string; name: string; probability: number }[]>().notNull(),
    tiebreakers: jsonb("tiebreakers").$type<Tiebreaker[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("decisions_user_client_uniq").on(t.userId, t.clientId),
    index("decisions_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const preferences = pgTable("preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  defaultEngine: text("default_engine").$type<EngineId>().notNull().default("laya"),
  defaultRadiusKm: real("default_radius_km").notNull().default(1.5),
  voiceLanguage: text("voice_language").notNull().default("en-US"),
  soundEnabled: text("sound_enabled").notNull().default("0"), // "0"/"1" - kept as text to match localStorage's own encoding
});

export type User = typeof users.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type PreferencesRow = typeof preferences.$inferSelect;
