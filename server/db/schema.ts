// Placeholder — full schema (users, signals, rubric_versions, scripts,
// characters, posts) lands in Step 2. Kept as a minimal valid module so
// server/db/client.ts (Step 1) type-checks before Step 2 runs.
import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";

export const _placeholder = pgTable("_placeholder", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
