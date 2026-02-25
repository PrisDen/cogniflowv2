import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { recalculateUserGaps } from "../src/lib/gaps.js";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.SESSION_POOLER_URL! }) });

async function main() {
  const user = await db.user.findUniqueOrThrow({ where: { email: "test1@cogniflow.dev" } });
  console.log(`Recalculating gaps for ${user.email}…`);
  await recalculateUserGaps(user.id, db);
  console.log("Done.");
  await db.$disconnect();
}

main().catch(console.error);
