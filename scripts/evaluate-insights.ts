/**
 * Cogniflow — Insight Evaluation Pipeline
 *
 * Computes precision / recall / F1 for each human-label dimension by
 * comparing system-generated observations against expert annotations.
 *
 * Input:  exports/annotation-dataset.json
 * Output: exports/insight-evaluation.json
 *
 * Usage:
 *   pnpm tsx scripts/evaluate-insights.ts
 *   pnpm tsx scripts/evaluate-insights.ts --input path/to/dataset.json
 *   pnpm tsx scripts/evaluate-insights.ts --output path/to/report.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliOptions {
  inputPath:  string;
  outputPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    inputPath:  resolve("exports", "annotation-dataset.json"),
    outputPath: resolve("exports", "insight-evaluation.json"),
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = args[i + 1];

    if ((flag === "--input"  || flag === "-i") && next) { opts.inputPath  = resolve(next); i++; }
    else if ((flag === "--output" || flag === "-o") && next) { opts.outputPath = resolve(next); i++; }
    else if (flag.startsWith("-")) {
      console.error(`[evaluate-insights] Unknown flag: ${flag}`);
      process.exit(1);
    }
  }

  return opts;
}

function log(msg: string) {
  process.stderr.write(`[evaluate-insights] ${msg}\n`);
}

// ── Input types ────────────────────────────────────────────────────────────

// At annotation time all values are null; after review they become true/false.
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
  sessionId: string;
  systemInsights: Array<{ observation: string; message: string }>;
  humanLabels: Record<HumanLabelKey, LabelValue>;
}

// ── Label → observation mapping ────────────────────────────────────────────

/**
 * Maps each human-label dimension to the set of system observation codes
 * that constitute a positive prediction for that label.
 *
 * A session is predicted "positive" for a label if ANY of its mapped
 * observations appear in systemInsights.
 */
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

// ── Confusion matrix ───────────────────────────────────────────────────────

interface Counts {
  TP: number;
  FP: number;
  FN: number;
  TN: number;
  /** Sessions where the human label was not null (annotated). */
  annotated: number;
}

interface LabelMetrics extends Counts {
  /** TP + FN — total positives in ground truth. */
  support:   number;
  precision: number | null;   // null when TP + FP === 0
  recall:    number | null;   // null when TP + FN === 0
  f1:        number | null;   // null when precision or recall is null/0
}

interface EvaluationReport {
  perLabel:        Record<HumanLabelKey, LabelMetrics>;
  overallMacroF1:  number | null;
  overallMicroF1:  number | null;
}

// ── Prediction logic ───────────────────────────────────────────────────────

function isPositivePrediction(
  item: AnnotationItem,
  label: HumanLabelKey,
): boolean {
  const targetObservations = new Set(LABEL_TO_OBSERVATIONS[label]);
  return item.systemInsights.some((ins) => targetObservations.has(ins.observation));
}

// ── Metric computation ─────────────────────────────────────────────────────

function computePrecision(tp: number, fp: number): number | null {
  const denom = tp + fp;
  return denom === 0 ? null : tp / denom;
}

function computeRecall(tp: number, fn: number): number | null {
  const denom = tp + fn;
  return denom === 0 ? null : tp / denom;
}

function computeF1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  const denom = precision + recall;
  return denom === 0 ? null : (2 * precision * recall) / denom;
}

function toLabelMetrics(counts: Counts): LabelMetrics {
  const precision = computePrecision(counts.TP, counts.FP);
  const recall    = computeRecall(counts.TP, counts.FN);
  const f1        = computeF1(precision, recall);

  return {
    ...counts,
    support:   counts.TP + counts.FN,
    precision: precision !== null ? round3(precision) : null,
    recall:    recall    !== null ? round3(recall)    : null,
    f1:        f1        !== null ? round3(f1)        : null,
  };
}

function round3(n: number): number {
  return Math.round(n * 1_000) / 1_000;
}

// ── Aggregates ─────────────────────────────────────────────────────────────

function macroF1(perLabel: Record<HumanLabelKey, LabelMetrics>): number | null {
  const scores = ALL_LABELS
    .map((l) => perLabel[l].f1)
    .filter((f): f is number => f !== null);

  if (scores.length === 0) return null;
  return round3(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function microF1(perLabel: Record<HumanLabelKey, LabelMetrics>): number | null {
  let totalTP = 0, totalFP = 0, totalFN = 0;

  for (const label of ALL_LABELS) {
    const m = perLabel[label];
    totalTP += m.TP;
    totalFP += m.FP;
    totalFN += m.FN;
  }

  const precision = computePrecision(totalTP, totalFP);
  const recall    = computeRecall(totalTP, totalFN);
  const f1        = computeF1(precision, recall);

  return f1 !== null ? round3(f1) : null;
}

// ── Core evaluation ────────────────────────────────────────────────────────

function evaluate(items: AnnotationItem[]): EvaluationReport {
  const counts: Record<HumanLabelKey, Counts> = {} as Record<HumanLabelKey, Counts>;

  for (const label of ALL_LABELS) {
    counts[label] = { TP: 0, FP: 0, FN: 0, TN: 0, annotated: 0 };
  }

  for (const item of items) {
    // Pre-compute the set of observations present in this session.
    const observedSet = new Set(item.systemInsights.map((i) => i.observation));

    for (const label of ALL_LABELS) {
      const groundTruth = item.humanLabels[label];

      // Skip unannotated sessions — they cannot contribute to accuracy metrics.
      if (groundTruth === null) continue;

      counts[label].annotated++;

      const targetObservations = LABEL_TO_OBSERVATIONS[label];
      const predicted = targetObservations.some((obs) => observedSet.has(obs));

      if (predicted && groundTruth)       counts[label].TP++;
      else if (predicted && !groundTruth) counts[label].FP++;
      else if (!predicted && groundTruth) counts[label].FN++;
      else                                counts[label].TN++;
    }
  }

  const perLabel = Object.fromEntries(
    ALL_LABELS.map((label) => [label, toLabelMetrics(counts[label])]),
  ) as Record<HumanLabelKey, LabelMetrics>;

  return {
    perLabel,
    overallMacroF1: macroF1(perLabel),
    overallMicroF1: microF1(perLabel),
  };
}

// ── Console table ──────────────────────────────────────────────────────────

function fmt(n: number | null, width = 7): string {
  const s = n === null ? "—" : n.toFixed(3);
  return s.padStart(width);
}

function fmtInt(n: number, width = 5): string {
  return String(n).padStart(width);
}

function printTable(report: EvaluationReport) {
  const LABEL_W  = 21;
  const col      = (s: string, w: number) => s.padEnd(w);

  const hr = "─".repeat(LABEL_W + 9 + 8 + 8 + 6 + 6 + 6 + 6 + 11);

  console.log("");
  console.log(
    col("Label", LABEL_W) +
    "│" + "Precision".padStart(9) +
    "│" + "Recall".padStart(8) +
    "│" + "F1".padStart(8) +
    "│" + "TP".padStart(6) +
    "│" + "FP".padStart(6) +
    "│" + "FN".padStart(6) +
    "│" + "TN".padStart(6) +
    "│" + "Annotated".padStart(11),
  );
  console.log(hr);

  for (const label of ALL_LABELS) {
    const m = report.perLabel[label];
    console.log(
      col(label, LABEL_W) +
      "│" + fmt(m.precision, 9) +
      "│" + fmt(m.recall, 8) +
      "│" + fmt(m.f1, 8) +
      "│" + fmtInt(m.TP, 6) +
      "│" + fmtInt(m.FP, 6) +
      "│" + fmtInt(m.FN, 6) +
      "│" + fmtInt(m.TN, 6) +
      "│" + fmtInt(m.annotated, 11),
    );
  }

  console.log(hr);
  console.log(
    `Macro F1: ${report.overallMacroF1 !== null ? report.overallMacroF1.toFixed(3) : "—"}` +
    `   |   Micro F1: ${report.overallMicroF1 !== null ? report.overallMicroF1.toFixed(3) : "—"}`,
  );
  console.log("");

  const totalAnnotated = ALL_LABELS.reduce(
    (sum, l) => sum + report.perLabel[l].annotated, 0,
  );
  if (totalAnnotated === 0) {
    console.log(
      "  ⚠  No annotated sessions found. All humanLabels are null.\n" +
      "     Run the annotation review process before evaluating.",
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  if (!existsSync(opts.inputPath)) {
    console.error(
      `[evaluate-insights] ERROR: Input file not found: ${opts.inputPath}\n` +
      `Run "pnpm tsx scripts/build-annotation-dataset.ts" first.`,
    );
    process.exit(1);
  }

  log(`Reading annotation dataset: ${opts.inputPath}`);
  const raw   = readFileSync(opts.inputPath, "utf8");
  const items = JSON.parse(raw) as AnnotationItem[];
  log(`  Loaded ${items.length} session(s).`);

  const annotatedAny = items.filter((s) =>
    ALL_LABELS.some((l) => s.humanLabels[l] !== null),
  ).length;
  log(`  Sessions with at least one annotation: ${annotatedAny}`);

  const report = evaluate(items);

  printTable(report);

  mkdirSync(resolve("exports"), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(report, null, 2), "utf8");
  log(`Report written → ${opts.outputPath}`);
}

main();
