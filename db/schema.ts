import { pgTable, serial, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

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
