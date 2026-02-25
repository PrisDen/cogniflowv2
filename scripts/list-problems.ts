import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.SESSION_POOLER_URL! }) });

async function main() {
  const ps = await db.problem.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } });
  console.log(JSON.stringify(ps, null, 2));
  await db.$disconnect();
}

main().catch(console.error);
