import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Returns a Drizzle client over Neon's stateless HTTP driver.
 *
 * Deliberately a function, not a module-level `export const db`. The HTTP
 * driver holds no connection, so creating one per call costs nothing - and
 * a per-call client is what keeps this safe on runtimes that forbid reusing
 * I/O objects across requests.
 *
 * Uses the POOLED connection string (DATABASE_URL). Migrations use
 * DATABASE_URL_UNPOOLED via drizzle.config.ts instead.
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

export type Db = ReturnType<typeof getDb>;
