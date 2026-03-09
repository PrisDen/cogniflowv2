/**
 * Cogniflow — Gap Aggregation Engine
 *
 * After each check-in, this recalculates all UserConceptGap rows for a user.
 * Also implements cross-session observations 13–15:
 *   13. Concept Gap          — a concept is consistently harder than the user's average
 *   14. Improvement Trend    — recent sessions for a concept are measurably better
 *   15. Persistent Restart   — restarts appear in > 50% of last 10 sessions
 *
 * ── Gap model (v2) ─────────────────────────────────────────────────────────
 *
 * Classification is anchored to per-session baselines rather than a global
 * denominator so that adding easy sessions cannot retroactively reclassify
 * concepts the user hasn't touched.
 *
 * For each session s (processed chronologically):
 *   baselineErrors_s  = mean(errorCount  for all sessions before s)
 *   baselineMinutes_s = mean(durationMin for all sessions before s)
 *
 *   errorRatio_s = errorCount_s  / baselineErrors_s   (1.0 when no prior baseline)
 *   timeRatio_s  = durationMin_s / baselineMinutes_s  (1.0 when no prior baseline)
 *
 * Multi-tag attribution: if a problem has k tags, the session contributes
 * weight 1/k to each tag's weighted mean, ensuring the total influence of any
 * single session across all tags sums to 1.
 *
 *   conceptErrorRatio = Σ(errorRatio_s × w_s) / Σ(w_s)   where w_s = 1/k_s
 *   conceptTimeRatio  = Σ(timeRatio_s  × w_s) / Σ(w_s)
 *
 * These pre-computed ratios are stored in avgErrorCount / avgSessionMinutes
 * (field names kept for schema stability). deriveGapStatus reads them directly.
 */

import type { PrismaClient } from "@/generated/prisma/client";

// ── Derived status ─────────────────────────────────────────────────────────

export type GapStatus = "gap" | "developing" | "strong" | "not_yet";

/**
 * Classify a concept's gap status from pre-computed normalised ratios.
 *
 * avgErrorCount    stores conceptErrorRatio  (concept / rolling baseline)
 * avgSessionMinutes stores conceptTimeRatio  (concept / rolling baseline)
 *
 * Both fields default to 1.0 (neutral) when absent, which keeps newly-seen
 * concepts in "developing" until enough sessions accumulate.
 *
 * Requires ≥ 3 sessions to surface "gap" or "strong"; fewer → "developing".
 */
export function deriveGapStatus(row: {
  sessionsAttempted: number;
  avgErrorCount:     number | null;
  avgSessionMinutes: number | null;
}): GapStatus {
  if (row.sessionsAttempted === 0) return "not_yet";
  if (row.sessionsAttempted < 3)  return "developing";

  // Stored values are pre-computed normalised ratios.
  const errorRatio = row.avgErrorCount     ?? 1;
  const timeRatio  = row.avgSessionMinutes ?? 1;

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
 * Algorithm is O(n) over sessions:
 *   1. Load all finished sessions (one query).
 *   2. Single chronological pass:
 *      - Maintain rolling error/time sums for baseline computation.
 *      - For each session, derive normalised ratios against the rolling
 *        baseline of PREVIOUS sessions only (update-after-use).
 *      - Accumulate weighted ratios per concept tag (weight = 1/k).
 *   3. Upsert one UserConceptGap row per concept.
 *
 * Backward compatibility: sessions without stored baseline fields are handled
 * transparently — the rolling baseline is always computed dynamically from the
 * sorted session list, so no stored baseline values are read or required.
 */
export async function recalculateUserGaps(
  userId: string,
  db: PrismaClient,
): Promise<void> {
  // One query — no additional reads anywhere in this function.
  const sessions = await db.session.findMany({
    where:   { userId, endedAt: { not: null } },
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

  // Flatten to per-session metrics (still O(n)).
  const sessionMetrics = sessions.map((s) => ({
    startedAt:    s.startedAt,
    durationMin:  (s.endedAt!.getTime() - s.startedAt.getTime()) / 60_000,
    errorCount:   s.events.filter((e) => {
      const m = e.metadata as Record<string, unknown>;
      return m.error_type != null && m.error_type !== "";
    }).length,
    conceptTagIds: s.problem.problemConceptTags.map((t) => t.conceptTagId),
  }));

  // ── Single forward sweep ─────────────────────────────────────────────────

  interface ConceptAccum {
    /** Σ(errorRatio_s × w_s) */
    weightedErrorRatioSum: number;
    /** Σ(timeRatio_s × w_s) */
    weightedTimeRatioSum:  number;
    /** Σ(w_s) = Σ(1/k_s) — denominator for the weighted mean. */
    effectiveWeight:       number;
    /** Actual session count (integer) — used for sessionsAttempted and trend gate. */
    sessionCount:          number;
    /** Raw per-session values for trend comparison (first-2 vs last-2). */
    sessionsForTrend:      Array<{ errorCount: number; durationMin: number }>;
  }

  const conceptAccum = new Map<string, ConceptAccum>();

  // Rolling totals — updated AFTER each session is processed so the baseline
  // for session s never includes session s itself.
  let rollingErrorSum = 0;
  let rollingMinSum   = 0;
  let rollingCount    = 0;

  for (const m of sessionMetrics) {
    const k = m.conceptTagIds.length;

    // Baseline from strictly prior sessions.
    // First session (rollingCount === 0) has no prior history — assign neutral
    // ratio 1.0 so it doesn't bias any concept toward gap or strong.
    const baselineErrors = rollingCount > 0 ? rollingErrorSum / rollingCount : null;
    const baselineMin    = rollingCount > 0 ? rollingMinSum   / rollingCount : null;

    const errorRatio = (baselineErrors !== null && baselineErrors > 0)
      ? m.errorCount  / baselineErrors : 1;
    const timeRatio  = (baselineMin    !== null && baselineMin    > 0)
      ? m.durationMin / baselineMin    : 1;

    // 1/k weighting: each session's total influence across all its tags = 1.
    // Untagged sessions (k === 0) contribute to the rolling baseline but not
    // to any concept accumulator.
    const weight = k > 0 ? 1 / k : 0;

    for (const tagId of m.conceptTagIds) {
      if (!conceptAccum.has(tagId)) {
        conceptAccum.set(tagId, {
          weightedErrorRatioSum: 0,
          weightedTimeRatioSum:  0,
          effectiveWeight:       0,
          sessionCount:          0,
          sessionsForTrend:      [],
        });
      }
      const acc = conceptAccum.get(tagId)!;
      acc.weightedErrorRatioSum += errorRatio * weight;
      acc.weightedTimeRatioSum  += timeRatio  * weight;
      acc.effectiveWeight        += weight;
      acc.sessionCount++;
      // Sessions are already chronological — push preserves order for trend.
      acc.sessionsForTrend.push({ errorCount: m.errorCount, durationMin: m.durationMin });
    }

    // Update rolling totals AFTER attribution (baseline = previous only).
    rollingErrorSum += m.errorCount;
    rollingMinSum   += m.durationMin;
    rollingCount++;
  }

  // Latest overall averages — stored as reference in UserConceptGap.
  const latestBaselineErrors = rollingCount > 0 ? rollingErrorSum / rollingCount : 0;
  const latestBaselineMin    = rollingCount > 0 ? rollingMinSum   / rollingCount : 0;

  // ── Upsert per-concept stats ─────────────────────────────────────────────

  for (const [conceptTagId, acc] of conceptAccum) {
    const n = acc.sessionCount;

    // Weighted mean of normalised ratios.
    // Stored in avgErrorCount / avgSessionMinutes (field names kept for schema
    // stability — semantics changed from raw averages to pre-computed ratios).
    const conceptErrorRatio = acc.effectiveWeight > 0
      ? acc.weightedErrorRatioSum / acc.effectiveWeight : 1;
    const conceptTimeRatio  = acc.effectiveWeight > 0
      ? acc.weightedTimeRatioSum  / acc.effectiveWeight : 1;

    // Trend: directional signal — first-2 vs last-2 raw session values.
    // Weighting not applied here; the trend is an ordinal direction, not a
    // magnitude comparison against a baseline.
    let trend: "improving" | "stable" | "declining" | null = null;
    if (n >= 4) {
      const sm           = acc.sessionsForTrend;
      const first2Errors = (sm[0].errorCount + sm[1].errorCount) / 2;
      const last2Errors  = (sm[n - 2].errorCount + sm[n - 1].errorCount) / 2;
      const first2Min    = (sm[0].durationMin + sm[1].durationMin) / 2;
      const last2Min     = (sm[n - 2].durationMin + sm[n - 1].durationMin) / 2;

      const errorImprovePct = first2Errors > 0 ? (first2Errors - last2Errors) / first2Errors : 0;
      const timeImprovePct  = first2Min    > 0 ? (first2Min    - last2Min)    / first2Min    : 0;
      const composite       = (errorImprovePct + timeImprovePct) / 2;

      trend = composite >= 0.3 ? "improving" : composite <= -0.3 ? "declining" : "stable";
    }

    await db.userConceptGap.upsert({
      where:  { userId_conceptTagId: { userId, conceptTagId } },
      create: {
        userId, conceptTagId,
        sessionsAttempted:    n,
        avgErrorCount:        conceptErrorRatio,    // pre-computed ratio
        avgSessionMinutes:    conceptTimeRatio,     // pre-computed ratio
        userOverallAvgErrors:  latestBaselineErrors, // reference only
        userOverallAvgMinutes: latestBaselineMin,    // reference only
        trend:                trend ?? undefined,
      },
      update: {
        sessionsAttempted:    n,
        avgErrorCount:        conceptErrorRatio,
        avgSessionMinutes:    conceptTimeRatio,
        userOverallAvgErrors:  latestBaselineErrors,
        userOverallAvgMinutes: latestBaselineMin,
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

  const restartCount = await db.sessionInsight.count({
    where: {
      sessionId:   { in: sessionIds },
      observation: "restart",
    },
  });

  return restartCount > recentSessions.length / 2;
}
