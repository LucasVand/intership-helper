import { pgTable, serial, text, timestamp, boolean, index, integer } from "drizzle-orm/pg-core";

export const internships = pgTable(
  "internships",
  {
    id: serial("id").primaryKey(),
    company: text("company").notNull(),
    role: text("role").notNull(),
    location: text("location").notNull(),
    applicationLinks: text("application_links").array().notNull(),
    age: text("age"),
    applied: boolean("applied").notNull().default(false),
    // Legend flags — parsed from README emojis
    noSponsorship: boolean("no_sponsorship").notNull().default(false), // 🛂
    requiresCitizenship: boolean("requires_citizenship").notNull().default(false), // 🇺🇸
    isClosed: boolean("is_closed").notNull().default(false), // 🔒
    isFaang: boolean("is_faang").notNull().default(false), // 🔥
    requiresAdvancedDegree: boolean("requires_advanced_degree").notNull().default(false), // 🎓
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("company_idx").on(table.company),
    index("age_idx").on(table.age),
    index("applied_idx").on(table.applied),
    index("is_faang_idx").on(table.isFaang),
    index("is_closed_idx").on(table.isClosed),
  ]
);

export type Internship = typeof internships.$inferSelect;
export type NewInternship = typeof internships.$inferInsert;

export const topPickKeywords = pgTable(
  "top_pick_keywords",
  {
    id: serial("id").primaryKey(),
    keyword: text("keyword").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("keyword_idx").on(table.keyword)]
);

export type TopPickKeyword = typeof topPickKeywords.$inferSelect;
export type NewTopPickKeyword = typeof topPickKeywords.$inferInsert;

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // counts
    scrapedCount: integer("scraped_count").notNull(),
    existingCount: integer("existing_count").notNull(),
    insertedCount: integer("inserted_count").notNull(),
    updatedCount: integer("updated_count").notNull(),
    totalAfter: integer("total_after").notNull(),
    // timing
    durationMs: integer("duration_ms").notNull(),
    // status: success | dry_run | no_db | failed | skipped
    status: text("status").notNull(),
    // optional details
    error: text("error"),
    scrapedUrl: text("scraped_url"),
  },
  (table) => [index("sync_runs_created_at_idx").on(table.createdAt)]
);

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
