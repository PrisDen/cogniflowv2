/**
 * Cogniflow — Session Export Tool
 *
 * Exports complete session data to JSON for research and expert labeling.
 * Processes sessions in batches (cursor pagination) so memory usage stays
 * constant regardless of dataset size.
 *
 * Usage:
 *   pnpm tsx scripts/export-sessions.ts
 *   pnpm tsx scripts/export-sessions.ts --limit 100
 *   pnpm tsx scripts/export-sessions.ts --user <userId>
 *   pnpm tsx scripts/export-sessions.ts --since 2025-01-01
 *
 * Output: exports/sessions-export.json
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { createWriteStream, mkdirSync } from "fs";
import { resolve } from "path";
import { PrismaClient, type UserConceptGap } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { deriveGapStatus } from "../src/lib/gaps.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface CliOptions {
  userId?: string;
  limit:   number;
  since?:  Date;
}

interface GapSnapshot {
  conceptTagId:       string;
  conceptSlug:        string;
  conceptLabel:       string;
  sessionsAttempted:  number;
  conceptErrorRatio:  number | null;
  conceptTimeRatio:   number | null;
  trend:              string | null;
  classification:     string;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(): CliOptions {
  const args   = process.argv.slice(2);
  const opts: CliOptions = { limit: Infinity };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = args[i + 1];

    if ((flag === "--user" || flag === "-u") && next) {
      opts.userId = next;
      i++;
    } else if ((flag === "--limit" || flag === "-l") && next) {
      const n = parseInt(next, 10);
      if (isNaN(n) || n < 1) fatal(`--limit must be a positive integer, got: ${next}`);
      opts.limit = n;
      i++;
    } else if ((flag === "--since" || flag === "-s") && next) {
      const d = new Date(next);
      if (isNaN(d.getTime())) fatal(`--since must be a valid ISO date, got: ${next}`);
      opts.since = d;
      i++;
    } else if (flag.startsWith("-")) {
      fatal(`Unknown flag: ${flag}\nUsage: --user ID  --limit N  --since DATE`);
    }
  }

  return opts;
}

function fatal(msg: string): never {
  console.error(`[export-sessions] ERROR: ${msg}`);
  process.exit(1);
}

function log(msg: string) {
  process.stderr.write(`[export-sessions] ${msg}\n`);
}

// ── Database setup ─────────────────────────────────────────────────────────

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.SESSION_POOLER_URL! }),
});

// ── Gap cache (one DB round-trip per unique user) ──────────────────────────

// Key: userId → conceptTagId → UserConceptGap with conceptTag relation
type GapRow = UserConceptGap & {
  conceptTag: { slug: string; label: string };
};
const gapCache = new Map<string, Map<string, GapRow>>();

async function gapsForUser(userId: string): Promise<Map<string, GapRow>> {
  if (!gapCache.has(userId)) {
    const rows = await db.userConceptGap.findMany({
      where:   { userId },
      include: { conceptTag: { select: { slug: true, label: true } } },
    });
    gapCache.set(
      userId,
      new Map(rows.map((r) => [r.conceptTagId, r as GapRow])),
    );
  }
  return gapCache.get(userId)!;
}

function buildGapSnapshot(gapRow: GapRow): GapSnapshot {
  const classification = deriveGapStatus({
    sessionsAttempted: gapRow.sessionsAttempted,
    avgErrorCount:     gapRow.avgErrorCount,
    avgSessionMinutes: gapRow.avgSessionMinutes,
  });

  return {
    conceptTagId:      gapRow.conceptTagId,
    conceptSlug:       gapRow.conceptTag.slug,
    conceptLabel:      gapRow.conceptTag.label,
    sessionsAttempted: gapRow.sessionsAttempted,
    conceptErrorRatio: gapRow.avgErrorCount,
    conceptTimeRatio:  gapRow.avgSessionMinutes,
    trend:             gapRow.trend,
    classification,
  };
}

// ── Session query ──────────────────────────────────────────────────────────

const BATCH_SIZE = 50;

// Prisma include shape used for every batch fetch.
const SESSION_INCLUDE = {
  problem: {
    include: {
      problemConceptTags: {
        include: { conceptTag: { select: { id: true, slug: true, label: true } } },
      },
    },
  },
  events: {
    orderBy: { occurredAt: "asc" as const },
    select:  { type: true, occurredAt: true, metadata: true },
  },
  insights: {
    orderBy: { priority: "asc" as const },
    select:  { observation: true, message: true, priority: true, createdAt: true },
  },
} as const;

type SessionRow = Awaited<
  ReturnType<typeof db.session.findMany<{ include: typeof SESSION_INCLUDE }>>
>[number];

async function toExportObject(s: SessionRow) {
  const conceptTags = s.problem.problemConceptTags.map((t) => ({
    id:    t.conceptTag.id,
    slug:  t.conceptTag.slug,
    label: t.conceptTag.label,
  }));

  const userGaps = await gapsForUser(s.userId);
  const gapSnapshot: GapSnapshot[] = conceptTags
    .map((t) => userGaps.get(t.id))
    .filter((g): g is GapRow => g !== undefined)
    .map(buildGapSnapshot);

  return {
    sessionId:  s.id,
    userId:     s.userId,
    problemId:  s.problemId,
    startedAt:  s.startedAt,
    endedAt:    s.endedAt,
    outcome:    s.outcome,

    problem: {
      title:       s.problem.title,
      difficulty:  s.problem.difficultyTier,
      conceptTags: conceptTags.map((t) => ({ slug: t.slug, label: t.label })),
    },

    events: s.events.map((e) => ({
      type:       e.type,
      occurredAt: e.occurredAt,
      metadata:   e.metadata,
    })),

    insights: s.insights.map((i) => ({
      observation: i.observation,
      message:     i.message,
      priority:    i.priority,
      createdAt:   i.createdAt,
    })),

    gapSnapshot,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  const outputPath = resolve("exports", "sessions-export.json");
  mkdirSync(resolve("exports"), { recursive: true });

  const stream = createWriteStream(outputPath, { encoding: "utf8" });

  // Wrap stream.write in a promise so backpressure is respected.
  function write(chunk: string): Promise<void> {
    return new Promise((res, rej) => {
      const ok = stream.write(chunk, (err) => (err ? rej(err) : res()));
      if (!ok) stream.once("drain", res);
    });
  }

  log("Starting export…");
  if (opts.userId) log(`  Filter: user = ${opts.userId}`);
  if (opts.since)  log(`  Filter: since = ${opts.since.toISOString()}`);
  if (isFinite(opts.limit)) log(`  Filter: limit = ${opts.limit}`);
  log(`  Output: ${outputPath}`);

  await write("[\n");

  let cursor:   string | undefined;
  let exported  = 0;
  let isFirst   = true;

  const where = {
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.since  ? { startedAt: { gte: opts.since } } : {}),
  };

  outer: while (true) {
    const remaining = isFinite(opts.limit) ? opts.limit - exported : BATCH_SIZE;
    if (remaining <= 0) break;

    const batch = await db.session.findMany({
      where,
      orderBy: { startedAt: "asc" },
      take:    Math.min(BATCH_SIZE, remaining),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: SESSION_INCLUDE,
    });

    if (batch.length === 0) break;

    for (const session of batch) {
      const obj = await toExportObject(session);

      if (!isFirst) await write(",\n");
      await write(JSON.stringify(obj, null, 2));
      isFirst = false;
      exported++;

      if (exported % 50 === 0) log(`  Exported ${exported} sessions…`);

      if (isFinite(opts.limit) && exported >= opts.limit) break outer;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  await write("\n]\n");

  await new Promise<void>((res, rej) => stream.end((err?: Error | null) => (err ? rej(err) : res())));

  log(`Done. Exported ${exported} session(s) → ${outputPath}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[export-sessions] Fatal error:", err);
  await db.$disconnect();
  process.exit(1);
});
