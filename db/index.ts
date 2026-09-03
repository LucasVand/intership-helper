import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL not set — db will not connect. Run npm run db:setup and set DATABASE_URL (DB is required, no JSON fallback).");
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1") || connectionString.includes("db") ? false : { rejectUnauthorized: false },
    })
  : null;

export const db = pool ? drizzle(pool, { schema }) : null;
export { pool, schema };
