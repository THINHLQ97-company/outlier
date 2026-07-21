import type { Config } from "drizzle-kit";

// `drizzle-kit generate` reads schema → emits SQL into server/db/migrations.
// `generate` does not need DATABASE_URL (only push/migrate do).
export default {
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
} satisfies Config;
