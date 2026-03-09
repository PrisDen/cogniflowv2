/**
 * Cogniflow — Gap Model Predictive Validation
 *
 * Tests whether concept gap classifications (computed from prior sessions only)
 * predict actual learner difficulty in subsequent sessions.
 *
 * The unit of observation is (session × concept tag). A session with k tags
 * generates k observations, each carrying the gap state for that concept
 * immediately before the session began.
 *
 * Gap state is recomputed from the raw session history using the same
 * rolling-baseline algorithm as recalculateUserGaps, ensuring we only use
 * information available before each session.
 *
 * Input:  exports/sessions-export.json
 * Output: exports/gap-predictive-analysis.json
 *
 * Usage:
 *   pnpm tsx scripts/analyze-gap-prediction.ts
 *   pnpm tsx scripts/analyze-gap-prediction.ts --input path/to/export.json
 *   pnpm tsx scripts/analyze-gap-prediction.ts --output path/to/report.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { deriveGapStatus, type GapStatus } from "../src/lib/gaps.js";

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliOptions {
  inputPath:  string;
  outputPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    inputPath:  resolve("exports", "sessions-export.json"),
    outputPath: resolve("exports", "gap-predictive-analysis.json"),
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], next = args[i + 1];
    if ((flag === "--input"  || flag === "-i") && next) { opts.inputPath  = resolve(next); i++; }
    else if ((flag === "--output" || flag === "-o") && next) { opts.outputPath = resolve(next); i++; }
    else if (flag.startsWith("-")) {
      console.error(`[analyze-gap-prediction] Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  return opts;
}

function log(msg: string) { process.stderr.write(`[analyze-gap-prediction] ${msg}\n`); }

// ── Input types (shape produced by export-sessions.ts) ─────────────────────

interface ExportedEvent {
  type:      string;
  occurredAt: string;
  metadata:  Record<string, unknown>;
}

interface ExportedSession {
  sessionId: string;
  userId:    string;
  startedAt: string;
  endedAt:   string | null;
  problem: {
    title:       string;
    difficulty:  string;
    conceptTags: Array<{ slug: string; label: string }>;
  };
  events: ExportedEvent[];
}

// ── Gap model: rolling baseline (mirrors recalculateUserGaps) ───────────────

/**
 * Accumulated state for one concept tag, built from sessions prior to the
 * one currently being evaluated.
 */
interface ConceptState {
  weightedErrorRatioSum: number;
  weightedTimeRatioSum:  number;
  effectiveWeight:       number;
  sessionCount:          number;
}

function classifyFromState(state: ConceptState | undefined): GapStatus {
  if (!state || state.sessionCount === 0) return "not_yet";
  return deriveGapStatus({
    sessionsAttempted: state.sessionCount,
    avgErrorCount:     state.effectiveWeight > 0
      ? state.weightedErrorRatioSum / state.effectiveWeight : null,
    avgSessionMinutes: state.effectiveWeight > 0
      ? state.weightedTimeRatioSum  / state.effectiveWeight : null,
  });
}

// ── Session metrics ────────────────────────────────────────────────────────

function sessionErrorCount(events: ExportedEvent[]): number {
  return events.filter((e) => {
    if (e.type !== "run" && e.type !== "submit") return false;
    const et = e.metadata.error_type;
    return typeof et === "string" && et !== "";
  }).length;
}

function sessionDurationMin(s: ExportedSession): number {
  if (!s.endedAt) return 0;
  return (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000;
}

// ── Observation ────────────────────────────────────────────────────────────

interface Observation {
  gapState:    GapStatus;
  errorCount:  number;
  durationMin: number;
  conceptSlug: string;
  userId:      string;
  sessionId:   string;
}

// ── Main analysis loop ─────────────────────────────────────────────────────

function buildObservations(sessions: ExportedSession[]): Observation[] {
  // Group by user, process each user's sessions chronologically.
  const byUser = new Map<string, ExportedSession[]>();
  for (const s of sessions) {
    if (!s.endedAt) continue;    // skip unfinished sessions
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push(s);
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  }

  const observations: Observation[] = [];

  for (const [userId, userSessions] of byUser) {
    // Rolling baseline — updated AFTER each session so it excludes the current one.
    let rollingErrorSum = 0;
    let rollingMinSum   = 0;
    let rollingCount    = 0;

    // Accumulated concept states — also updated after each session.
    const conceptStates = new Map<string, ConceptState>();

    for (const session of userSessions) {
      const k          = session.problem.conceptTags.length;
      const weight     = k > 0 ? 1 / k : 0;
      const errorCount = sessionErrorCount(session.events);
      const durMin     = sessionDurationMin(session);

      // Baseline from strictly prior sessions.
      const baselineErrors = rollingCount > 0 ? rollingErrorSum / rollingCount : null;
      const baselineMin    = rollingCount > 0 ? rollingMinSum   / rollingCount : null;

      // Normalized ratios for this session.
      const errorRatio = baselineErrors !== null && baselineErrors > 0
        ? errorCount / baselineErrors : 1;
      const timeRatio  = baselineMin    !== null && baselineMin    > 0
        ? durMin     / baselineMin    : 1;

      // Record one observation per concept tag using the state BEFORE this session.
      for (const tag of session.problem.conceptTags) {
        const gapState = classifyFromState(conceptStates.get(tag.slug));
        observations.push({
          gapState,
          errorCount,
          durationMin: durMin,
          conceptSlug: tag.slug,
          userId,
          sessionId:   session.sessionId,
        });
      }

      // Update concept states AFTER recording observations (preserve before-state).
      for (const tag of session.problem.conceptTags) {
        if (!conceptStates.has(tag.slug)) {
          conceptStates.set(tag.slug, {
            weightedErrorRatioSum: 0,
            weightedTimeRatioSum:  0,
            effectiveWeight:       0,
            sessionCount:          0,
          });
        }
        const state = conceptStates.get(tag.slug)!;
        state.weightedErrorRatioSum += errorRatio * weight;
        state.weightedTimeRatioSum  += timeRatio  * weight;
        state.effectiveWeight       += weight;
        state.sessionCount++;
      }

      // Update rolling totals AFTER attribution.
      rollingErrorSum += errorCount;
      rollingMinSum   += durMin;
      rollingCount++;
    }
  }

  return observations;
}

// ── Aggregation ────────────────────────────────────────────────────────────

interface GroupStats {
  sessionCount:  number;
  avgErrorCount: number;
  avgDuration:   number;
}

function groupStats(obs: Observation[]): GroupStats {
  if (obs.length === 0) {
    return { sessionCount: 0, avgErrorCount: 0, avgDuration: 0 };
  }
  const n    = obs.length;
  const avgE = obs.reduce((s, o) => s + o.errorCount,  0) / n;
  const avgD = obs.reduce((s, o) => s + o.durationMin, 0) / n;
  return { sessionCount: n, avgErrorCount: round3(avgE), avgDuration: round3(avgD) };
}

function round3(n: number): number {
  return Math.round(n * 1_000) / 1_000;
}

// ── Statistics (Welch's t-test, pure implementation) ───────────────────────

/**
 * Log-gamma via Lanczos approximation (Numerical Recipes coefficients).
 * Accurate to ~15 significant figures for z > 0.
 */
function lnGamma(z: number): number {
  const g   = 7;
  const c   = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized incomplete beta function I(x; a, b) via Lentz continued fractions.
 * Switches to the symmetry form I(x;a,b) = 1-I(1-x;b,a) when x > (a+1)/(a+b+2)
 * so the series always converges.
 */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - regularizedBeta(1 - x, b, a);

  const lbeta    = lnGamma(a + b) - lnGamma(a) - lnGamma(b);
  const prefactor = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

  // Lentz's algorithm for the continued fraction.
  const TINY     = 1e-30;
  const EPS      = 1e-10;
  const MAX_ITER = 300;

  let f = TINY, C = TINY, D = 0;
  D = 1 / (1 - (a + b) * x / (a + 1));
  if (Math.abs(D) < TINY) D = TINY;
  C = TINY;
  f = TINY * D;

  for (let m = 1; m <= MAX_ITER; m++) {
    // Even numerator coefficient
    const dEven = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    D = 1 + dEven * D; if (Math.abs(D) < TINY) D = TINY;
    C = 1 + dEven / C; if (Math.abs(C) < TINY) C = TINY;
    D = 1 / D;
    f *= C * D;

    // Odd numerator coefficient
    const dOdd = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    D = 1 + dOdd * D; if (Math.abs(D) < TINY) D = TINY;
    C = 1 + dOdd / C; if (Math.abs(C) < TINY) C = TINY;
    D = 1 / D;
    const delta = C * D;
    f *= delta;

    if (Math.abs(delta - 1) < EPS) break;
  }

  return prefactor * f;
}

/**
 * Two-tailed p-value for Welch's t-test.
 * Formula: p = I(df/(df + t²), df/2, 0.5)
 */
function welchPValue(t: number, df: number): number {
  const x = df / (df + t * t);
  return regularizedBeta(x, df / 2, 0.5);
}

interface TTestResult {
  t:  number;
  df: number;
  p:  number;
}

function welchTTest(a: number[], b: number[]): TTestResult | null {
  const n1 = a.length, n2 = b.length;
  if (n1 < 2 || n2 < 2) return null;

  const mean1 = a.reduce((s, v) => s + v, 0) / n1;
  const mean2 = b.reduce((s, v) => s + v, 0) / n2;
  const var1  = a.reduce((s, v) => s + (v - mean1) ** 2, 0) / (n1 - 1);
  const var2  = b.reduce((s, v) => s + (v - mean2) ** 2, 0) / (n2 - 1);

  const s1 = var1 / n1, s2 = var2 / n2;
  const se = Math.sqrt(s1 + s2);
  if (se === 0) return { t: 0, df: n1 + n2 - 2, p: 1 };

  const t  = (mean1 - mean2) / se;
  const df = (s1 + s2) ** 2 / (s1 ** 2 / (n1 - 1) + s2 ** 2 / (n2 - 1));
  const p  = welchPValue(t, df);

  return { t: round3(t), df: round3(df), p: round3(p) };
}

// ── Output types ───────────────────────────────────────────────────────────

interface PredictiveReport {
  byGapState: {
    gap:        GroupStats;
    developing: GroupStats;
    strong:     GroupStats;
    not_yet:    GroupStats;
  };
  effectSizes: {
    error:    number;
    duration: number;
  };
  statistics: {
    gap_n:              number;
    strong_n:           number;
    min_sample_for_test: number;
    error_ttest_t:      number | null;
    error_ttest_df:     number | null;
    error_ttest_p:      number | null;
    duration_ttest_t:   number | null;
    duration_ttest_df:  number | null;
    duration_ttest_p:   number | null;
  };
  meta: {
    totalSessions:    number;
    totalUsers:       number;
    totalObservations: number;
  };
}

// ── Console table ──────────────────────────────────────────────────────────

function printReport(report: PredictiveReport) {
  const { byGapState: g, effectSizes, statistics: stat, meta } = report;

  console.log("");
  console.log("═".repeat(60));
  console.log("  GAP MODEL — PREDICTIVE VALIDATION");
  console.log("═".repeat(60));
  console.log(
    `  Sessions: ${meta.totalSessions}  |  Users: ${meta.totalUsers}  ` +
    `|  Observations: ${meta.totalObservations}`,
  );
  console.log("");
  console.log(
    "  " +
    "Gap state".padEnd(14) +
    "Observations".padStart(14) +
    "Avg errors".padStart(12) +
    "Avg minutes".padStart(13),
  );
  console.log("  " + "─".repeat(53));

  const rows: [string, GroupStats][] = [
    ["gap",        g.gap],
    ["developing", g.developing],
    ["strong",     g.strong],
    ["not_yet",    g.not_yet],
  ];
  for (const [label, gs] of rows) {
    console.log(
      "  " +
      label.padEnd(14) +
      String(gs.sessionCount).padStart(14) +
      gs.avgErrorCount.toFixed(2).padStart(12) +
      gs.avgDuration.toFixed(1).padStart(13),
    );
  }

  console.log("");
  console.log(`  Effect sizes  (gap − strong):`);
  console.log(`    Error count : ${effectSizes.error >= 0 ? "+" : ""}${effectSizes.error.toFixed(3)}`);
  console.log(`    Duration    : ${effectSizes.duration >= 0 ? "+" : ""}${effectSizes.duration.toFixed(1)} min`);

  console.log("");
  if (stat.error_ttest_p !== null) {
    console.log(`  Welch's t-test (gap n=${stat.gap_n}, strong n=${stat.strong_n}):`);
    console.log(
      `    Error count : t=${stat.error_ttest_t?.toFixed(3)}, ` +
      `df=${stat.error_ttest_df?.toFixed(1)}, p=${stat.error_ttest_p?.toFixed(4)}` +
      (stat.error_ttest_p !== null && stat.error_ttest_p < 0.05 ? "  *" : ""),
    );
    console.log(
      `    Duration    : t=${stat.duration_ttest_t?.toFixed(3)}, ` +
      `df=${stat.duration_ttest_df?.toFixed(1)}, p=${stat.duration_ttest_p?.toFixed(4)}` +
      (stat.duration_ttest_p !== null && stat.duration_ttest_p < 0.05 ? "  *" : ""),
    );
  } else {
    console.log(
      `  Statistical test skipped — requires ≥ ${stat.min_sample_for_test} observations per group ` +
      `(gap: ${stat.gap_n}, strong: ${stat.strong_n}).`,
    );
  }
  console.log("");
}

// ── Main ───────────────────────────────────────────────────────────────────

const MIN_SAMPLE_FOR_TEST = 30;

function main() {
  const opts = parseArgs();

  if (!existsSync(opts.inputPath)) {
    console.error(
      `[analyze-gap-prediction] ERROR: Not found: ${opts.inputPath}\n` +
      `Run "pnpm tsx scripts/export-sessions.ts" first.`,
    );
    process.exit(1);
  }

  log(`Reading session export: ${opts.inputPath}`);
  const sessions = JSON.parse(readFileSync(opts.inputPath, "utf8")) as ExportedSession[];
  log(`  Loaded ${sessions.length} session(s).`);

  const observations = buildObservations(sessions);
  log(`  Built ${observations.length} (session × concept) observations.`);

  // Partition by gap state.
  const byState: Record<GapStatus, Observation[]> = {
    gap:        [],
    developing: [],
    strong:     [],
    not_yet:    [],
  };
  for (const obs of observations) byState[obs.gapState].push(obs);

  const byGapState = {
    gap:        groupStats(byState.gap),
    developing: groupStats(byState.developing),
    strong:     groupStats(byState.strong),
    not_yet:    groupStats(byState.not_yet),
  };

  const effectSizes = {
    error:    round3(byGapState.gap.avgErrorCount - byGapState.strong.avgErrorCount),
    duration: round3(byGapState.gap.avgDuration   - byGapState.strong.avgDuration),
  };

  // Statistical test — only between gap and strong (the meaningful contrast).
  const gapN    = byState.gap.length;
  const strongN = byState.strong.length;
  const runTest = gapN >= MIN_SAMPLE_FOR_TEST && strongN >= MIN_SAMPLE_FOR_TEST;

  const errTest = runTest
    ? welchTTest(
        byState.gap.map((o) => o.errorCount),
        byState.strong.map((o) => o.errorCount),
      )
    : null;

  const durTest = runTest
    ? welchTTest(
        byState.gap.map((o) => o.durationMin),
        byState.strong.map((o) => o.durationMin),
      )
    : null;

  const totalUsers = new Set(sessions.map((s) => s.userId)).size;

  const report: PredictiveReport = {
    byGapState,
    effectSizes,
    statistics: {
      gap_n:               gapN,
      strong_n:            strongN,
      min_sample_for_test: MIN_SAMPLE_FOR_TEST,
      error_ttest_t:       errTest?.t       ?? null,
      error_ttest_df:      errTest?.df      ?? null,
      error_ttest_p:       errTest?.p       ?? null,
      duration_ttest_t:    durTest?.t       ?? null,
      duration_ttest_df:   durTest?.df      ?? null,
      duration_ttest_p:    durTest?.p       ?? null,
    },
    meta: {
      totalSessions:     sessions.length,
      totalUsers,
      totalObservations: observations.length,
    },
  };

  printReport(report);

  mkdirSync(resolve("exports"), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(report, null, 2), "utf8");
  log(`Report written → ${opts.outputPath}`);
}

main();
