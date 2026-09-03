import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { internships } from "../db/schema";
import internshipsData from "../internships.json";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Check .env");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  console.log(`Seeding ${internshipsData.length} internships...`);

  // Optional: clear existing
  const shouldClear = process.argv.includes("--clear");
  if (shouldClear) {
    console.log("Clearing existing internships...");
    await db.delete(internships);
  }

  // Batch insert with legend flags (if present in JSON)
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < internshipsData.length; i += batchSize) {
    const batch = internshipsData.slice(i, i + batchSize).map((row: any) => ({
      company: row.company,
      role: row.role,
      location: row.location,
      applicationLinks: row.application_links,
      age: row.age ?? null,
      applied: false,
      noSponsorship: Boolean(row.no_sponsorship),
      requiresCitizenship: Boolean(row.requires_citizenship),
      isClosed: Boolean(row.is_closed),
      isFaang: Boolean(row.is_faang),
      requiresAdvancedDegree: Boolean(row.requires_advanced_degree),
    }));
    await db.insert(internships).values(batch);
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${internshipsData.length}`);
  }

  console.log(`Done — inserted ${inserted} rows`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
