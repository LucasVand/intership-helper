import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

async function main() {
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Database migrations applied successfully.");
  } catch (error) {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
