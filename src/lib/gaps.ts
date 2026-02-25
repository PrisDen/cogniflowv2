/**
 * Cogniflow — Gap Aggregation Engine
 *
 * After each check-in, this recalculates all UserConceptGap rows for a user.
 * Also implements cross-session observations 13–15:
 *   13. Concept Gap   — a concept is consistently harder than the user's average
 *   14. Improvement Trend — recent sessions for a concept are measurably better
 *   15. Persistent Restart — restarts appear in > 50% of last 10 sessions
 */

import type { PrismaClient } from "@/generated/prisma/client";

// ── Derived status ─────────────────────────────────────────────────────────

export type GapStatus = "gap" | "developing" | "strong" | "not_yet";

/**
 * Determine a concept's gap status from stored aggregates.
 * Requires at least 3 sessions to surface a gap or strong status.
 */
export function deriveGapStatus(row: {
  sessionsAttempted:     number;
  avgErrorCount:         number | null;
  avgSessionMinutes:     number | null;
  userOverallAvgErrors:  number | null;
  userOverallAvgMinutes: number | null;
}): GapStatus {
  if (row.sessionsAttempted === 0) return "not_yet";

  const overallErrors = row.userOverallAvgErrors ?? 0;
  const overallMin    = row.userOverallAvgMinutes ?? 0;
  const avgErrors     = row.avgErrorCount ?? 0;
  const avgMin        = row.avgSessionMinutes ?? 0;

  if (row.sessionsAttempted < 3) return "developing";

  const errorRatio = overallErrors > 0 ? avgErrors / overallErrors : 1;
  const timeRatio  = overallMin   > 0 ? avgMin    / overallMin    : 1;

  if (errorRatio >= 1.8 || timeRatio >= 1.8) return "gap";
  if (errorRatio <= 0.7 && timeRatio <= 0.7) return "strong";
  return "developing";
}

// ── Cross-session insight messages ─────────────────────────────────────────

export function buildGapInsightMessage(conceptLabel: string, sessionsAttempted: number): string {
  return `You've worked on ${sessionsAttempted} problems tagged as ${conceptLabel}. They've consistently been harder for you — more errors, longer sessions. This is your clearest gap right now. General problem-solving practice won't close it as fast as working on ${conceptLabel} specifically and deliberately.`;
}

export function buildImprovementMessage(conceptLabel: string): string {
  return `Your ${conceptLabel} sessions have gotten measurably better — fewer errors, faster solves than when you started. That's what consistent practice actually looks like. The progress is real even when individual sessions don't feel like it.`;
}

export function buildRestartPatternMessage(): string {
  return `You've restarted your code in more than half your recent sessions. Look at that honestly: was it because the approach was genuinely wrong, or because debugging felt harder than starting over? Restarting avoids discomfort. Debugging through that discomfort is where the actual skill builds.`;
}

// ── Core recalculation ─────────────────────────────────────────────────────

/**
 * Recalculate all UserConceptGap rows for a user from scratch.
 * Called after every check-in submission.
 *
 * Uses endedAt sessions only; duration = endedAt − startedAt.
 * Error proxy = run events where metadata.error_type != null.
 */
export async function recalculateUserGaps(
  userId: string,
  db: PrismaClient,
): Promise<void> {
  // Load all finished sessions with run events and concept tags
  const sessions = await db.session.findMany({
    where: { userId, endedAt: { not: null } },
    orderBy: { startedAt: "asc" },
    include: {
      problem: {
        include: {
          problemConceptTags: { select: { conceptTagId: true } },
        },
      },
      events: {
        where:  { type: "run" },
        select: { metadata: true },
      },
    },
  });

  if (sessions.length === 0) return;

  // Per-session metrics
  const sessionMetrics = sessions.map((s) => ({
    startedAt:    s.startedAt,
    durationMin:  (s.endedAt!.getTime() - s.startedAt.getTime()) / 60_000,
    errorCount:   s.events.filter((e) => {
      const m = e.metadata as Record<string, unknown>;
      return m.error_type && m.error_type !== null;
    }).length,
    conceptTagIds: s.problem.problemConceptTags.map((t) => t.conceptTagId),
  }));

  // Overall user averages (across all sessions)
  const overallAvgErrors = sessionMetrics.reduce((s, m) => s + m.errorCount, 0) / sessionMetrics.length;
  const overallAvgMin    = sessionMetrics.reduce((s, m) => s + m.durationMin, 0) / sessionMetrics.length;

  // Group by concept tag
  const byTag = new Map<string, typeof sessionMetrics>();
  for (const m of sessionMetrics) {
    for (const tagId of m.conceptTagIds) {
      if (!byTag.has(tagId)) byTag.set(tagId, []);
      byTag.get(tagId)!.push(m);
    }
  }

  // Upsert per-concept stats
  for (const [conceptTagId, tagMetrics] of byTag) {
    const n               = tagMetrics.length;
    const avgErrorCount   = tagMetrics.reduce((s, m) => s + m.errorCount, 0) / n;
    const avgSessionMin   = tagMetrics.reduce((s, m) => s + m.durationMin, 0) / n;

    // Trend: need ≥ 4 sessions to compare first-2 vs last-2
    let trend: "improving" | "stable" | "declining" | null = null;
    if (n >= 4) {
      const first2ErrorAvg = (tagMetrics[0].errorCount + tagMetrics[1].errorCount) / 2;
      const last2ErrorAvg  = (tagMetrics[n - 2].errorCount + tagMetrics[n - 1].errorCount) / 2;
      const first2MinAvg   = (tagMetrics[0].durationMin + tagMetrics[1].durationMin) / 2;
      const last2MinAvg    = (tagMetrics[n - 2].durationMin + tagMetrics[n - 1].durationMin) / 2;

      const errorImprovePct = first2ErrorAvg > 0
        ? (first2ErrorAvg - last2ErrorAvg) / first2ErrorAvg : 0;
      const timeImprovePct  = first2MinAvg > 0
        ? (first2MinAvg - last2MinAvg) / first2MinAvg : 0;
      const composite = (errorImprovePct + timeImprovePct) / 2;

      trend = composite >= 0.3 ? "improving" : composite <= -0.3 ? "declining" : "stable";
    }

    await db.userConceptGap.upsert({
      where:  { userId_conceptTagId: { userId, conceptTagId } },
      create: {
        userId, conceptTagId,
        sessionsAttempted:    n,
        avgErrorCount,
        avgSessionMinutes:    avgSessionMin,
        userOverallAvgErrors:  overallAvgErrors,
        userOverallAvgMinutes: overallAvgMin,
        trend:                trend ?? undefined,
      },
      update: {
        sessionsAttempted:    n,
        avgErrorCount,
        avgSessionMinutes:    avgSessionMin,
        userOverallAvgErrors:  overallAvgErrors,
        userOverallAvgMinutes: overallAvgMin,
        trend:                trend ?? undefined,
        lastUpdated:          new Date(),
      },
    });
  }
}

// ── Observation 15: Persistent Restart Pattern ────────────────────────────

/**
 * Returns true if restarts appeared in > 50% of the last 10 sessions
 * (minimum 5 sessions to activate).
 */
export async function checkPersistentRestart(
  userId: string,
  db: PrismaClient,
): Promise<boolean> {
  const recentSessions = await db.session.findMany({
    where:   { userId, checkinCompletedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    take:    10,
    select:  { id: true },
  });

  if (recentSessions.length < 5) return false;

  const sessionIds = recentSessions.map((s) => s.id);

  // Count sessions that had a 'restart' insight
  const restartCount = await db.sessionInsight.count({
    where: {
      sessionId:   { in: sessionIds },
      observation: "restart",
    },
  });

  return restartCount > recentSessions.length / 2;
}
