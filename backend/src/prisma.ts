import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Safely parse pool size from DATABASE_URL's ?connection_limit param (default: 10)
let connLimit = 10;
try {
  if (process.env.DATABASE_URL) {
    const dbUrl = new URL(process.env.DATABASE_URL);
    connLimit = parseInt(dbUrl.searchParams.get('connection_limit') || '10', 10);
  }
} catch (e) {
  // Ignore invalid URL
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: connLimit,
  idleTimeoutMillis: 30_000,   // Release idle connections after 30s
  connectionTimeoutMillis: 10_000, // Fail fast instead of hanging
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });