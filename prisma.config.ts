import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local first (Next.js convention), fallback to .env
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // SESSION_POOLER_URL (port 5432 via pooler subdomain) supports DDL/introspection for CLI.
  // DATABASE_URL (port 6543, transaction pooler) is used at runtime via PrismaPg adapter.
  datasource: {
    url: process.env.SESSION_POOLER_URL!,
  },
});
