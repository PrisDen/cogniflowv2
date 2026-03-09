/**
 * Cogniflow Behavioral Metrics Engine.
 *
 * Two layers:
 *
 * Layer 1 — computeSessionBehaviorMetrics / computeBehaviorTrends
 *   Rate-based metrics (syntaxErrorRate, timeToFirstRun) consumed by the
 *   gap engine and internal analytics.
 *
 * Layer 2 — buildSessionBehaviorSummary / buildBehaviorHistory / summarizeBehaviorPatterns
 *   Count-based session summaries intended for the dashboard timeline.
 *   Introduces logicFailures and edgeCaseHandling trend.
 *
 * Constraints:
 *   - Does NOT modify the insight rule engine.
 *   - Does NOT modify telemetry collection.
 *   - All metrics are derived from existing event data.
 *   - All per-session functions run in O(n) over the event list.
 */

import type { InsightEvent, Insight } from "@/lib/insights";

// ── Types ──────────────────────────────────────────────────────────────────

export type TrendDirection = "improving" | "stable" | "worsening";

/**
 * Per-session behavioral metrics snapshot.
 * All fields that can be undefined for a session with insufficient data
 * are typed as `number | null`.
 */
export interface SessionBehaviorMetrics {
  /**
   * Fraction of error runs that were syntax errors (SyntaxError /
   * IndentationError / TabError). null when there were no error runs.
   */
  syntaxErrorRate: number | null;

  /** Total number of run + submit events in the session. */
  runCount: number;

  /** Whether a restart insight fired during this session. */
  restartDetected: boolean;

  /** Whether an edge_case_blindness insight fired during this session. */
  edgeCaseFailure: boolean;

  /**
   * Seconds between session start and the first run-like event.
   * null when no run or submit events exist.
   */
  timeToFirstRun: number | null;
}

/** Minimal session summary consumed by computeBehaviorTrends(). */
export interface SessionSummary {
  /** ISO timestamp or Date — used only for ordering when sessions are unsorted. */
  startedAt: Date | string;
  metrics: SessionBehaviorMetrics;
}

export interface BehaviorTrends {
  /**
   * Whether syntax error rate is decreasing across sessions.
   * "improving" = rate is falling; "worsening" = rate is rising.
   */
  syntaxErrorTrend: TrendDirection;

  /**
   * Whether the learner is running code more frequently across sessions.
   * "improving" = runCount is rising.
   */
  runFrequencyTrend: TrendDirection;

  /**
   * Whether restart behaviour is decreasing across sessions.
   * "improving" = fewer restarts in recent sessions.
   */
  restartTrend: TrendDirection;
}

// ── Constants ─────────────────────────────────────────────────────────────

const SYNTAX_ERROR_TYPES = new Set(["SyntaxError", "IndentationError", "TabError"]);

/**
 * Minimum relative change (as a fraction) between first-half and last-half
 * averages required to classify a trend as improving or worsening.
 * Changes smaller than this are classified as "stable".
 */
const TREND_THRESHOLD = 0.15;

// ── Helpers ────────────────────────────────────────────────────────────────

function eventsOfType(events: InsightEvent[], type: string): InsightEvent[] {
  return events.filter((e) => e.type === type);
}

/**
 * Compute the direction of change between two averages.
 * lowerIsBetter = true  → a falling average is "improving"
 * lowerIsBetter = false → a rising  average is "improving"
 */
function trendDirection(
  firstHalfAvg: number,
  lastHalfAvg: number,
  lowerIsBetter: boolean,
): TrendDirection {
  if (firstHalfAvg === 0 && lastHalfAvg === 0) return "stable";

  const baseline = firstHalfAvg === 0 ? lastHalfAvg : firstHalfAvg;
  const relativeChange = (lastHalfAvg - firstHalfAvg) / baseline;

  if (Math.abs(relativeChange) < TREND_THRESHOLD) return "stable";

  const isDecreasing = relativeChange < 0;
  const isImproving  = lowerIsBetter ? isDecreasing : !isDecreasing;
  return isImproving ? "improving" : "worsening";
}

/** Safe average — returns 0 for an empty array. */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ── Per-session metrics ───────────────────────────────────────────────────

/**
 * Derive behavioral metrics for a single session in O(n) over events.
 *
 * @param events         All session events for this session.
 * @param insights       The 0–2 insights generated for this session.
 * @param sessionStartedAt  Session start timestamp (required for timeToFirstRun).
 */
export function computeSessionBehaviorMetrics(
  events: InsightEvent[],
  insights: Insight[],
  sessionStartedAt?: Date,
): SessionBehaviorMetrics {
  // ── Single-pass over events ──────────────────────────────────────────────
  let errorRuns       = 0;
  let syntaxErrorRuns = 0;
  let runCount        = 0;
  let firstRunTime:   Date | null = null;

  for (const event of events) {
    const isRun    = event.type === "run";
    const isSubmit = event.type === "submit";

    if (isRun || isSubmit) {
      runCount++;

      if (firstRunTime === null || event.occurredAt < firstRunTime) {
        firstRunTime = event.occurredAt;
      }

      if (isRun) {
        const errType = String(event.metadata.error_type ?? "");
        if (errType) {
          errorRuns++;
          if (SYNTAX_ERROR_TYPES.has(errType)) syntaxErrorRuns++;
        }
      }
    }
  }

  // ── Derived metrics ──────────────────────────────────────────────────────

  const syntaxErrorRate: number | null =
    errorRuns > 0 ? syntaxErrorRuns / errorRuns : null;

  const timeToFirstRun: number | null =
    sessionStartedAt && firstRunTime
      ? (firstRunTime.getTime() - sessionStartedAt.getTime()) / 1_000
      : null;

  // ── Insight-derived flags ─────────────────────────────────────────────────
  const observations = new Set(insights.map((i) => i.observation));

  return {
    syntaxErrorRate,
    runCount,
    restartDetected: observations.has("restart"),
    edgeCaseFailure: observations.has("edge_case_blindness"),
    timeToFirstRun,
  };
}

// ── Multi-session trends ──────────────────────────────────────────────────

/**
 * Compute directional behavioral trends across multiple sessions.
 *
 * Requires at least 2 sessions. With fewer sessions every trend is "stable".
 *
 * Algorithm:
 *   1. Sort sessions chronologically.
 *   2. Split into first half and last half (ceiling split so last half is
 *      never smaller than first half when the count is odd).
 *   3. Compare per-metric averages between the two halves.
 *   4. Apply TREND_THRESHOLD to suppress noise on small changes.
 *
 * @param sessions  Array of SessionSummary objects in any order.
 */
export function computeBehaviorTrends(sessions: SessionSummary[]): BehaviorTrends {
  const stable: BehaviorTrends = {
    syntaxErrorTrend:  "stable",
    runFrequencyTrend: "stable",
    restartTrend:      "stable",
  };

  if (sessions.length < 2) return stable;

  // Sort chronologically by startedAt
  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const mid        = Math.ceil(sorted.length / 2);
  const firstHalf  = sorted.slice(0, mid);
  const lastHalf   = sorted.slice(mid);

  // ── syntaxErrorRate: lower is better ─────────────────────────────────────
  const syntaxFirst = firstHalf
    .map((s) => s.metrics.syntaxErrorRate)
    .filter((v): v is number => v !== null);
  const syntaxLast  = lastHalf
    .map((s) => s.metrics.syntaxErrorRate)
    .filter((v): v is number => v !== null);

  const syntaxErrorTrend: TrendDirection =
    syntaxFirst.length > 0 && syntaxLast.length > 0
      ? trendDirection(avg(syntaxFirst), avg(syntaxLast), true)
      : "stable";

  // ── runCount: higher is better ────────────────────────────────────────────
  const runFrequencyTrend = trendDirection(
    avg(firstHalf.map((s) => s.metrics.runCount)),
    avg(lastHalf.map((s) => s.metrics.runCount)),
    false,
  );

  // ── restartRate: lower is better ─────────────────────────────────────────
  const restartRate = (half: SessionSummary[]) =>
    half.filter((s) => s.metrics.restartDetected).length / half.length;

  const restartTrend = trendDirection(
    restartRate(firstHalf),
    restartRate(lastHalf),
    true,
  );

  return { syntaxErrorTrend, runFrequencyTrend, restartTrend };
}

// ── Behavioral history layer ──────────────────────────────────────────────

/**
 * Minimal session shape consumed by buildSessionBehaviorSummary.
 * Callers supply raw events + the insights already stored for the session.
 */
export interface SessionHistoryInput {
  id:        string;
  startedAt: Date | string;
  events:    InsightEvent[];
  insights:  Insight[];
}

/**
 * Count-based per-session snapshot intended for the dashboard timeline.
 * Uses raw counts (not rates) so individual sessions are easy to read
 * without needing to know the denominator.
 */
export interface SessionBehaviorSummary {
  sessionId:       string;
  /** ISO 8601 string for consistent serialisation. */
  startedAt:       string;
  /** Runs where error_type was SyntaxError / IndentationError / TabError. */
  syntaxErrors:    number;
  /** Total run + submit events. */
  runCount:        number;
  /** Whether a restart insight fired this session. */
  restartDetected: boolean;
  /** Whether an edge_case_blindness insight fired this session. */
  edgeCaseFailure: boolean;
  /** Runs that completed without an exception but failed at least one test case. */
  logicFailures:   number;
}

/**
 * Four-metric pattern summary with dashboard-friendly field names.
 * Produced by summarizeBehaviorPatterns().
 */
export interface BehaviorPatternSummary {
  /** Is the learner making fewer syntax errors over time? */
  syntaxErrors:     TrendDirection;
  /** Is the learner running code more often per session? */
  runFrequency:     TrendDirection;
  /** Is the learner restarting code less often? */
  restartBehavior:  TrendDirection;
  /** Is the learner hitting edge-case failures less often? */
  edgeCaseHandling: TrendDirection;
}

// ── Part 1: per-session summary ───────────────────────────────────────────

/**
 * Build a count-based behavioral summary for a single session in O(n).
 *
 * syntaxErrors  — run events whose error_type is a Python syntax class.
 * logicFailures — run events that completed without exception but failed tests.
 * runCount      — all run + submit events.
 * restartDetected / edgeCaseFailure — derived from the stored insight list.
 */
export function buildSessionBehaviorSummary(
  session: SessionHistoryInput,
): SessionBehaviorSummary {
  let syntaxErrors  = 0;
  let logicFailures = 0;
  let runCount      = 0;

  for (const event of session.events) {
    const isRun    = event.type === "run";
    const isSubmit = event.type === "submit";

    if (isRun || isSubmit) {
      runCount++;
    }

    if (isRun) {
      const errType   = String(event.metadata.error_type ?? "");
      const allPassed = Boolean(event.metadata.all_passed);
      const hasTests  = Number(event.metadata.total_count ?? 0) > 0;

      if (SYNTAX_ERROR_TYPES.has(errType)) {
        syntaxErrors++;
      } else if (!errType && hasTests && !allPassed) {
        logicFailures++;
      }
    }
  }

  const observations = new Set(session.insights.map((i) => i.observation));

  return {
    sessionId:       session.id,
    startedAt:       new Date(session.startedAt).toISOString(),
    syntaxErrors,
    runCount,
    restartDetected: observations.has("restart"),
    edgeCaseFailure: observations.has("edge_case_blindness"),
    logicFailures,
  };
}

// ── Part 2: recent history builder ───────────────────────────────────────

/**
 * Summarise the most recent sessions for the dashboard timeline.
 *
 * - Accepts any number of sessions in any order.
 * - Returns the latest 10, ordered newest → oldest.
 * - Each entry is a SessionBehaviorSummary produced by
 *   buildSessionBehaviorSummary().
 */
export function buildBehaviorHistory(
  userSessions: SessionHistoryInput[],
): SessionBehaviorSummary[] {
  return [...userSessions]
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .slice(0, 10)
    .map(buildSessionBehaviorSummary);
}

// ── Part 3: pattern summary ───────────────────────────────────────────────

/**
 * Compute four directional behavioral trends from a history array.
 *
 * Reuses the same first-half / last-half algorithm and TREND_THRESHOLD
 * already applied in computeBehaviorTrends(). Input order is normalised
 * to oldest → newest before splitting so callers can pass the history in
 * either direction.
 *
 * Requires at least 2 sessions; fewer returns all "stable".
 */
export function summarizeBehaviorPatterns(
  history: SessionBehaviorSummary[],
): BehaviorPatternSummary {
  const stable: BehaviorPatternSummary = {
    syntaxErrors:     "stable",
    runFrequency:     "stable",
    restartBehavior:  "stable",
    edgeCaseHandling: "stable",
  };

  if (history.length < 2) return stable;

  // Normalise to chronological order (oldest first) for the half-split.
  const sorted = [...history].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const mid       = Math.ceil(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const lastHalf  = sorted.slice(mid);

  // syntaxErrors: lower is better
  const syntaxErrors = trendDirection(
    avg(firstHalf.map((s) => s.syntaxErrors)),
    avg(lastHalf.map((s) => s.syntaxErrors)),
    true,
  );

  // runFrequency: higher is better
  const runFrequency = trendDirection(
    avg(firstHalf.map((s) => s.runCount)),
    avg(lastHalf.map((s) => s.runCount)),
    false,
  );

  // restartBehavior: lower is better (boolean → 0/1 rate)
  const restartRate = (half: SessionBehaviorSummary[]) =>
    half.filter((s) => s.restartDetected).length / half.length;

  const restartBehavior = trendDirection(
    restartRate(firstHalf),
    restartRate(lastHalf),
    true,
  );

  // edgeCaseHandling: lower failure rate is better
  const edgeRate = (half: SessionBehaviorSummary[]) =>
    half.filter((s) => s.edgeCaseFailure).length / half.length;

  const edgeCaseHandling = trendDirection(
    edgeRate(firstHalf),
    edgeRate(lastHalf),
    true,
  );

  return { syntaxErrors, runFrequency, restartBehavior, edgeCaseHandling };
}
