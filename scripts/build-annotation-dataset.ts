/**
 * Cogniflow — Annotation Dataset Builder
 *
 * Reads exports/sessions-export.json (produced by export-sessions.ts) and
 * writes exports/annotation-dataset.json — a curated, annotation-ready
 * dataset for human reviewers to label learner behaviors.
 *
 * Filtering rules (all must pass):
 *   • At least one run or submit event
 *   • At least one snapshot event
 *   • Session duration ≥ 2 minutes
 *
 * Sampling:
 *   Sessions that triggered at least one system insight are preferred.
 *   Maximum 200 sessions in the output.
 *
 * Usage:
 *   pnpm tsx scripts/build-annotation-dataset.ts
 *   pnpm tsx scripts/build-annotation-dataset.ts --input path/to/export.json
 *   pnpm tsx scripts/build-annotation-dataset.ts --limit 50
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliOptions {
  inputPath:  string;
  outputPath: string;
  limit:      number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    inputPath:  resolve("exports", "sessions-export.json"),
    outputPath: resolve("exports", "annotation-dataset.json"),
    limit:      200,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = args[i + 1];

    if ((flag === "--input" || flag === "-i") && next) {
      opts.inputPath = resolve(next);
      i++;
    } else if ((flag === "--output" || flag === "-o") && next) {
      opts.outputPath = resolve(next);
      i++;
    } else if ((flag === "--limit" || flag === "-l") && next) {
      const n = parseInt(next, 10);
      if (isNaN(n) || n < 1) fatal(`--limit must be a positive integer, got: ${next}`);
      opts.limit = n;
      i++;
    } else if (flag.startsWith("-")) {
      fatal(`Unknown flag: ${flag}\nUsage: --input FILE  --output FILE  --limit N`);
    }
  }

  return opts;
}

function fatal(msg: string): never {
  console.error(`[build-annotation-dataset] ERROR: ${msg}`);
  process.exit(1);
}

function log(msg: string) {
  process.stderr.write(`[build-annotation-dataset] ${msg}\n`);
}

// ── Input types (shape produced by export-sessions.ts) ─────────────────────

interface ExportedEvent {
  type:       string;
  occurredAt: string;
  metadata:   Record<string, unknown>;
}

interface ExportedInsight {
  observation: string;
  message:     string;
  priority:    number;
  createdAt:   string;
}

interface ExportedSession {
  sessionId:  string;
  userId:     string;
  problemId:  string;
  startedAt:  string;
  endedAt:    string | null;
  outcome:    string | null;
  problem: {
    title:       string;
    difficulty:  string;
    conceptTags: Array<{ slug: string; label: string }>;
  };
  events:    ExportedEvent[];
  insights:  ExportedInsight[];
}

// ── Output types ───────────────────────────────────────────────────────────

interface RunSummary {
  occurredAt:  string;
  passed_count: number | null;
  total_count:  number | null;
  error_type:   string | null;
}

interface SnapshotSummary {
  occurredAt: string;
  char_count: number | null;
}

interface AnnotationMeta {
  runCount:             number;
  snapshotCount:        number;
  errorCount:           number;
  firstRunTime:         string | null;
  timeToFirstKeystroke: number | null;   // seconds; null if no keystroke event
}

// All label fields start as null. Reviewers set them to true | false.
interface HumanLabels {
  reading_issue:       null;
  planning_issue:      null;
  syntax_struggle:     null;
  logic_struggle:      null;
  repeated_error:      null;
  stuck_debugging:     null;
  restart_behavior:    null;
  edge_case_blindness: null;
}

interface AnnotationItem {
  sessionId:       string;
  problemTitle:    string;
  conceptTags:     string[];       // slugs, for compact readability
  durationMinutes: number;
  outcome:         string | null;

  events:    ExportedEvent[];
  runs:      RunSummary[];
  snapshots: SnapshotSummary[];

  systemInsights: Array<{ observation: string; message: string }>;
  annotationMeta: AnnotationMeta;
  humanLabels:    HumanLabels;
}

// ── Filtering ──────────────────────────────────────────────────────────────

const MIN_DURATION_MIN = 2;

function durationMinutes(s: ExportedSession): number {
  if (!s.endedAt) return 0;
  return (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000;
}

function meetsAnnotationCriteria(s: ExportedSession): boolean {
  // Must have a recorded end time.
  if (!s.endedAt) return false;

  // Must meet minimum duration.
  if (durationMinutes(s) < MIN_DURATION_MIN) return false;

  const types = new Set(s.events.map((e) => e.type));

  // Must have executed code at least once.
  if (!types.has("run") && !types.has("submit")) return false;

  // Must have at least one code snapshot for reviewers to inspect.
  if (!types.has("snapshot")) return false;

  return true;
}

// ── Derived lists ──────────────────────────────────────────────────────────

function extractRuns(events: ExportedEvent[]): RunSummary[] {
  return events
    .filter((e) => e.type === "run" || e.type === "submit")
    .map((e) => {
      const m = e.metadata;
      return {
        occurredAt:   e.occurredAt,
        passed_count: typeof m.passed_count === "number" ? m.passed_count
                    : typeof m.passed      === "number" ? m.passed : null,
        total_count:  typeof m.total_count  === "number" ? m.total_count
                    : typeof m.total       === "number" ? m.total  : null,
        error_type:   typeof m.error_type === "string" && m.error_type !== ""
                    ? m.error_type : null,
      };
    });
}

function extractSnapshots(events: ExportedEvent[]): SnapshotSummary[] {
  return events
    .filter((e) => e.type === "snapshot")
    .map((e) => {
      const m = e.metadata;
      const charCount =
        typeof m.char_count === "number" ? m.char_count :
        typeof m.charCount  === "number" ? m.charCount  : null;
      return { occurredAt: e.occurredAt, char_count: charCount };
    });
}

// ── Annotation metadata ────────────────────────────────────────────────────

function buildAnnotationMeta(s: ExportedSession): AnnotationMeta {
  const runEvents  = s.events.filter((e) => e.type === "run" || e.type === "submit");
  const snapEvents = s.events.filter((e) => e.type === "snapshot");

  const errorCount = runEvents.filter((e) => {
    const et = e.metadata.error_type;
    return typeof et === "string" && et !== "";
  }).length;

  const firstRunEvent      = runEvents[0] ?? null;
  const firstKeystrokeEvent = s.events.find((e) => e.type === "first_keystroke") ?? null;

  const timeToFirstKeystroke = firstKeystrokeEvent
    ? Math.round(
        (new Date(firstKeystrokeEvent.occurredAt).getTime() -
         new Date(s.startedAt).getTime()) / 1_000,
      )
    : null;

  return {
    runCount:             runEvents.length,
    snapshotCount:        snapEvents.length,
    errorCount,
    firstRunTime:         firstRunEvent?.occurredAt ?? null,
    timeToFirstKeystroke,
  };
}

// ── Session → annotation item ──────────────────────────────────────────────

const BLANK_LABELS: HumanLabels = {
  reading_issue:       null,
  planning_issue:      null,
  syntax_struggle:     null,
  logic_struggle:      null,
  repeated_error:      null,
  stuck_debugging:     null,
  restart_behavior:    null,
  edge_case_blindness: null,
};

function toAnnotationItem(s: ExportedSession): AnnotationItem {
  return {
    sessionId:       s.sessionId,
    problemTitle:    s.problem.title,
    conceptTags:     s.problem.conceptTags.map((t) => t.slug),
    durationMinutes: Math.round(durationMinutes(s) * 10) / 10,
    outcome:         s.outcome,

    events:    s.events,
    runs:      extractRuns(s.events),
    snapshots: extractSnapshots(s.events),

    systemInsights: s.insights.map((i) => ({
      observation: i.observation,
      message:     i.message,
    })),

    annotationMeta: buildAnnotationMeta(s),

    // Spread so each item gets its own object (not a shared reference).
    humanLabels: { ...BLANK_LABELS },
  };
}

// ── Sampling ───────────────────────────────────────────────────────────────

/**
 * Sort eligible sessions so those with system insights appear first,
 * then by descending number of insights (more signal → more interesting
 * for annotators), then chronologically for stability.
 */
function sampleSessions(
  sessions: ExportedSession[],
  limit: number,
): ExportedSession[] {
  const eligible = sessions.filter(meetsAnnotationCriteria);

  eligible.sort((a, b) => {
    const aInsights = a.insights.length;
    const bInsights = b.insights.length;

    // Sessions with at least one insight come first.
    const aTier = aInsights > 0 ? 1 : 0;
    const bTier = bInsights > 0 ? 1 : 0;
    if (bTier !== aTier) return bTier - aTier;

    // Among sessions in the same tier, more insights = higher priority.
    if (bInsights !== aInsights) return bInsights - aInsights;

    // Tie-break: chronological order for reproducibility.
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });

  return eligible.slice(0, limit);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  if (!existsSync(opts.inputPath)) {
    fatal(
      `Input file not found: ${opts.inputPath}\n` +
      `Run "pnpm tsx scripts/export-sessions.ts" first.`,
    );
  }

  log(`Reading export: ${opts.inputPath}`);
  const raw    = readFileSync(opts.inputPath, "utf8");
  const all    = JSON.parse(raw) as ExportedSession[];
  log(`  Loaded ${all.length} session(s) from export.`);

  const sampled = sampleSessions(all, opts.limit);
  log(`  Eligible (run + snapshot + ≥${MIN_DURATION_MIN}min): ${all.filter(meetsAnnotationCriteria).length}`);
  log(`  Sampled for annotation: ${sampled.length} (limit: ${opts.limit})`);

  const dataset: AnnotationItem[] = sampled.map(toAnnotationItem);

  mkdirSync(resolve("exports"), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(dataset, null, 2), "utf8");

  log(`Done → ${opts.outputPath}`);

  // Summary breakdown for quick inspection.
  const withInsights = dataset.filter((d) => d.systemInsights.length > 0).length;
  log(`  With system insights: ${withInsights} / ${dataset.length}`);
  log(`  Without insights:     ${dataset.length - withInsights} / ${dataset.length}`);
}

main();
