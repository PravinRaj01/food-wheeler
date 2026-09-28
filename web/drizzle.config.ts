import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// drizzle-kit doesn't read Next.js's .env.local on its own.
config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (see .env.local)");

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Migrations use the DIRECT connection, not the pooler.
  dbCredentials: { url },
});
