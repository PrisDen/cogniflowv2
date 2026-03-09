/**
 * Cogniflow — Insight Error Analysis
 *
 * Identifies sessions where system predictions disagree with human annotations,
 * and produces a structured report for rule improvement.
 *
 * Inputs:
 *   exports/annotation-dataset.json   — per-session labels + events
 *   exports/insight-evaluation.json   — aggregated metrics (optional; enriches summary)
 *
 * Output:
 *   exports/error-analysis.json
 *
 * Usage:
 *   pnpm tsx scripts/analyze-insight-errors.ts
 *   pnpm tsx scripts/analyze-insight-errors.ts --dataset path/to/dataset.json
 *   pnpm tsx scripts/analyze-insight-errors.ts --eval path/to/evaluation.json
 *   pnpm tsx scripts/analyze-insight-errors.ts --output path/to/report.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliOptions {
  datasetPath:    string;
  evalPath:       string;
  outputPath:     string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    datasetPath: resolve("exports", "annotation-dataset.json"),
    evalPath:    resolve("exports", "insight-evaluation.json"),
    outputPath:  resolve("exports", "error-analysis.json"),
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = args[i + 1];
    if ((flag === "--dataset" || flag === "-d") && next) { opts.datasetPath = resolve(next); i++; }
    else if ((flag === "--eval"    || flag === "-e") && next) { opts.evalPath    = resolve(next); i++; }
    else if ((flag === "--output"  || flag === "-o") && next) { opts.outputPath  = resolve(next); i++; }
    else if (flag.startsWith("-")) {
      console.error(`[analyze-insight-errors] Unknown flag: ${flag}`);
      process.exit(1);
    }
  }

  return opts;
}

function log(msg: string) {
  process.stderr.write(`[analyze-insight-errors] ${msg}\n`);
}

// ── Types ──────────────────────────────────────────────────────────────────

type LabelValue = true | false | null;

type HumanLabelKey =
  | "reading_issue"
  | "planning_issue"
  | "syntax_struggle"
  | "logic_struggle"
  | "repeated_error"
  | "stuck_debugging"
  | "restart_behavior"
  | "edge_case_blindness";

interface AnnotationItem {
  sessionId:       string;
  problemTitle:    string;
  conceptTags:     string[];
  durationMinutes: number;
  outcome:         string | null;
  events:          unknown[];
  runs:            unknown[];
  snapshots:       unknown[];
  systemInsights:  Array<{ observation: string; message: string }>;
  annotationMeta:  {
    runCount:             number;
    snapshotCount:        number;
    errorCount:           number;
    firstRunTime:         string | null;
    timeToFirstKeystroke: number | null;
  };
  humanLabels: Record<HumanLabelKey, LabelValue>;
}

// Shape of a single label entry in insight-evaluation.json
interface EvalLabelMetrics {
  precision:  number | null;
  recall:     number | null;
  f1:         number | null;
  TP:         number;
  FP:         number;
  FN:         number;
  TN:         number;
  support:    number;
  annotated:  number;
}

interface EvaluationReport {
  perLabel:       Record<HumanLabelKey, EvalLabelMetrics>;
  overallMacroF1: number | null;
  overallMicroF1: number | null;
}

// ── Label → observation mapping ────────────────────────────────────────────
// Kept in sync with evaluate-insights.ts — both scripts derive predictions
// from the same mapping so error analysis is consistent with metric reporting.

const LABEL_TO_OBSERVATIONS: Record<HumanLabelKey, readonly string[]> = {
  reading_issue:       ["reading_time"],
  planning_issue:      ["no_planning", "planning_detected"],
  syntax_struggle:     ["syntax_heavy"],
  logic_struggle:      ["logic_heavy"],
  repeated_error:      ["repeated_error"],
  stuck_debugging:     ["stuck_loop", "long_stuck"],
  restart_behavior:    ["restart"],
  edge_case_blindness: ["edge_case_blindness"],
};

const ALL_LABELS = Object.keys(LABEL_TO_OBSERVATIONS) as HumanLabelKey[];

// ── Error case type ────────────────────────────────────────────────────────

interface ErrorCase {
  sessionId:    string;
  label:        HumanLabelKey;
  errorType:    "FP" | "FN";

  /**
   * Observations from LABEL_TO_OBSERVATIONS[label] that were present
   * in systemInsights for this session.
   * For FP: these are the rules that fired and shouldn't have.
   * For FN: this is always [] — nothing matched, hence the miss.
   */
  systemObservations: string[];

  /**
   * All observation codes that fired in this session (any label).
   * Included so researchers can see what the system saw overall,
   * which is especially diagnostic for FN cases.
   */
  allSystemObservations: string[];

  humanLabel:      boolean;
  runCount:        number;
  errorCount:      number;
  durationMinutes: number;
  events:          unknown[];
  runs:            unknown[];
  snapshots:       unknown[];
}

// ── Output type ────────────────────────────────────────────────────────────

interface ObservationFreq {
  observation: string;
  count:       number;
}

interface LabelCount {
  label: HumanLabelKey;
  count: number;
}

interface LabelSummaryRow {
  count:     number;
  precision: number | null;
  recall:    number | null;
  f1:        number | null;
}

interface Summary {
  totalSessions:    number;
  totalAnnotated:   number;
  totalErrors:      number;
  totalFP:          number;
  totalFN:          number;
  FP_by_label:      Record<string, LabelSummaryRow>;
  FN_by_label:      Record<string, LabelSummaryRow>;
  /** Observations most frequently implicated in false positive errors. */
  FP_observations:  ObservationFreq[];
  overallMacroF1:   number | null;
  overallMicroF1:   number | null;
}

interface ErrorReport {
  falsePositives: ErrorCase[];
  falseNegatives: ErrorCase[];
  summary:        Summary;
}

// ── Core analysis ──────────────────────────────────────────────────────────

function analyzeErrors(
  items: AnnotationItem[],
  evalReport: EvaluationReport | null,
): ErrorReport {
  const falsePositives: ErrorCase[] = [];
  const falseNegatives: ErrorCase[] = [];

  // Tallies for summary
  const fpByLabel = new Map<HumanLabelKey, number>();
  const fnByLabel = new Map<HumanLabelKey, number>();
  const fpObsCount = new Map<string, number>();

  let totalAnnotated = 0;

  for (const item of items) {
    const observedSet     = new Set(item.systemInsights.map((i) => i.observation));
    const allObservations = [...observedSet];

    // Track whether at least one label was annotated on this session.
    const hasAnyLabel = ALL_LABELS.some((l) => item.humanLabels[l] !== null);
    if (hasAnyLabel) totalAnnotated++;

    for (const label of ALL_LABELS) {
      const groundTruth = item.humanLabels[label];
      if (groundTruth === null) continue;   // unannotated — skip

      const mappedObs = LABEL_TO_OBSERVATIONS[label];
      const firedObs  = mappedObs.filter((obs) => observedSet.has(obs));
      const predicted = firedObs.length > 0;

      if (predicted === groundTruth) continue;   // correct — not an error

      const errorCase: ErrorCase = {
        sessionId:            item.sessionId,
        label,
        errorType:            predicted ? "FP" : "FN",
        systemObservations:   firedObs,
        allSystemObservations: allObservations,
        humanLabel:           groundTruth,
        runCount:             item.annotationMeta.runCount,
        errorCount:           item.annotationMeta.errorCount,
        durationMinutes:      item.durationMinutes,
        events:               item.events,
        runs:                 item.runs,
        snapshots:            item.snapshots,
      };

      if (predicted) {
        falsePositives.push(errorCase);
        fpByLabel.set(label, (fpByLabel.get(label) ?? 0) + 1);
        for (const obs of firedObs) {
          fpObsCount.set(obs, (fpObsCount.get(obs) ?? 0) + 1);
        }
      } else {
        falseNegatives.push(errorCase);
        fnByLabel.set(label, (fnByLabel.get(label) ?? 0) + 1);
      }
    }
  }

  // Build FP/FN by-label summary rows, enriched with eval metrics when available.
  function buildLabelRows(
    counts: Map<HumanLabelKey, number>,
  ): Record<string, LabelSummaryRow> {
    const rows: Record<string, LabelSummaryRow> = {};
    // Include all labels — 0 errors is still informative.
    for (const label of ALL_LABELS) {
      const metrics = evalReport?.perLabel[label];
      rows[label] = {
        count:     counts.get(label) ?? 0,
        precision: metrics?.precision ?? null,
        recall:    metrics?.recall    ?? null,
        f1:        metrics?.f1        ?? null,
      };
    }
    return rows;
  }

  const fpObservations: ObservationFreq[] = [...fpObsCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([observation, count]) => ({ observation, count }));

  const summary: Summary = {
    totalSessions:   items.length,
    totalAnnotated,
    totalErrors:     falsePositives.length + falseNegatives.length,
    totalFP:         falsePositives.length,
    totalFN:         falseNegatives.length,
    FP_by_label:     buildLabelRows(fpByLabel),
    FN_by_label:     buildLabelRows(fnByLabel),
    FP_observations: fpObservations,
    overallMacroF1:  evalReport?.overallMacroF1 ?? null,
    overallMicroF1:  evalReport?.overallMicroF1 ?? null,
  };

  return { falsePositives, falseNegatives, summary };
}

// ── Console output ─────────────────────────────────────────────────────────

function printSummary(report: ErrorReport) {
  const { summary } = report;
  const { FP_by_label, FN_by_label, FP_observations } = summary;

  console.log("");
  console.log("═".repeat(72));
  console.log("  INSIGHT ERROR ANALYSIS");
  console.log("═".repeat(72));
  console.log(
    `  Sessions: ${summary.totalSessions}  |  Annotated: ${summary.totalAnnotated}  |  Errors: ${summary.totalErrors} (FP: ${summary.totalFP}, FN: ${summary.totalFN})`,
  );
  if (summary.overallMacroF1 !== null) {
    console.log(
      `  Overall — Macro F1: ${summary.overallMacroF1.toFixed(3)}  |  Micro F1: ${(summary.overallMicroF1 ?? 0).toFixed(3)}`,
    );
  }

  const LABEL_W = 22;
  const hr = "─".repeat(LABEL_W + 8 + 10 + 8 + 8 + 2);

  // ── False Positive table ─────────────────────────────────────────────────
  console.log("");
  console.log("  FALSE POSITIVES — system fired, human said no");
  console.log(
    "  " +
    "Label".padEnd(LABEL_W) +
    "FP".padStart(6) +
    "Precision".padStart(10) +
    "Recall".padStart(8) +
    "F1".padStart(8),
  );
  console.log("  " + hr);

  const fpRows = ALL_LABELS
    .map((l) => ({ label: l, ...FP_by_label[l] }))
    .sort((a, b) => b.count - a.count);

  for (const row of fpRows) {
    console.log(
      "  " +
      row.label.padEnd(LABEL_W) +
      String(row.count).padStart(6) +
      fmtMetric(row.precision, 10) +
      fmtMetric(row.recall, 8) +
      fmtMetric(row.f1, 8),
    );
  }

  // ── False Negative table ─────────────────────────────────────────────────
  console.log("");
  console.log("  FALSE NEGATIVES — system missed, human said yes");
  console.log(
    "  " +
    "Label".padEnd(LABEL_W) +
    "FN".padStart(6) +
    "Precision".padStart(10) +
    "Recall".padStart(8) +
    "F1".padStart(8),
  );
  console.log("  " + hr);

  const fnRows = ALL_LABELS
    .map((l) => ({ label: l, ...FN_by_label[l] }))
    .sort((a, b) => b.count - a.count);

  for (const row of fnRows) {
    console.log(
      "  " +
      row.label.padEnd(LABEL_W) +
      String(row.count).padStart(6) +
      fmtMetric(row.precision, 10) +
      fmtMetric(row.recall, 8) +
      fmtMetric(row.f1, 8),
    );
  }

  // ── FP observation frequency ─────────────────────────────────────────────
  if (FP_observations.length > 0) {
    console.log("");
    console.log("  OBSERVATIONS MOST FREQUENTLY CAUSING FALSE POSITIVES");
    console.log("  " + "Observation".padEnd(28) + "FP count");
    console.log("  " + "─".repeat(38));
    for (const { observation, count } of FP_observations) {
      console.log("  " + observation.padEnd(28) + String(count));
    }
  }

  console.log("");

  if (summary.totalAnnotated === 0) {
    console.log(
      "  ⚠  No annotated sessions found. humanLabels are all null.\n" +
      "     Complete the annotation review before running error analysis.",
    );
  }
}

function fmtMetric(n: number | null, width: number): string {
  return (n === null ? "—" : n.toFixed(3)).padStart(width);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  if (!existsSync(opts.datasetPath)) {
    console.error(
      `[analyze-insight-errors] ERROR: Dataset not found: ${opts.datasetPath}\n` +
      `Run "pnpm tsx scripts/build-annotation-dataset.ts" first.`,
    );
    process.exit(1);
  }

  log(`Reading annotation dataset: ${opts.datasetPath}`);
  const items = JSON.parse(readFileSync(opts.datasetPath, "utf8")) as AnnotationItem[];
  log(`  Loaded ${items.length} session(s).`);

  let evalReport: EvaluationReport | null = null;
  if (existsSync(opts.evalPath)) {
    log(`Reading evaluation report: ${opts.evalPath}`);
    evalReport = JSON.parse(readFileSync(opts.evalPath, "utf8")) as EvaluationReport;
  } else {
    log(`Evaluation report not found (${opts.evalPath}) — summary will omit F1 scores.`);
    log(`Run "pnpm tsx scripts/evaluate-insights.ts" to generate it.`);
  }

  const report = analyzeErrors(items, evalReport);

  printSummary(report);

  mkdirSync(resolve("exports"), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(report, null, 2), "utf8");
  log(
    `Report written → ${opts.outputPath}  ` +
    `(FP: ${report.falsePositives.length}, FN: ${report.falseNegatives.length})`,
  );
}

main();
