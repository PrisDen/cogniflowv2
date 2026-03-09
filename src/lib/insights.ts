/**
 * Cogniflow Insight Engine — per-session rule-based observations.
 * Implements observations 1–12 from the insight-layer-spec.
 * Observations 13–15 are cross-session and live in the Gap Tracker.
 */

import {
  computeSessionActivity,
  buildActiveSegments,
  activeMsInRange,
  type ActiveSegment,
} from "@/lib/activityTracker";

// ── Types ──────────────────────────────────────────────────────────────────

export interface InsightEvent {
  type:       string;
  occurredAt: Date;
  metadata:   Record<string, unknown>;
}

/**
 * The learner's current gap status for a single concept tag on the problem.
 * Passed in via InsightInput.problem.conceptGaps so the engine can attach
 * contextual notes without touching gap model logic.
 */
export interface ConceptGapInfo {
  conceptSlug: string;
  status:      "gap" | "developing" | "strong";
}

export interface InsightInput {
  session: {
    startedAt:          Date;
    endedAt:            Date | null;
    checkinFeel:        number | null;   // 1=lost 2=struggled 3=okay 4=flowed
    checkinPreWork:     string | null;   // "paper" | "mind" | "none"
    checkinInterrupted: boolean | null;
    checkinConfidence:  number | null;   // 1=not_at_all 2=a_little 3=mostly 4=solid
  };
  problem: {
    wordCount:    number;
    /**
     * Optional gap state for each concept tag on this problem.
     * When provided, the engine attaches a contextual note to fired insights.
     * Omitting the field is safe — existing callers need no changes.
     */
    conceptGaps?: ConceptGapInfo[];
  };
  events:  InsightEvent[];
}

export interface Insight {
  observation:    string;                // slug key
  message:        string;                // exact text shown to the user
  evidence?:      Record<string, unknown>; // numeric signals that caused this rule to fire
  behaviorFocus?: string;               // one recommended habit for the next session
  /** Concept gap context linking this observation to the problem's concept area. */
  conceptContext?: {
    conceptSlug: string;
    status:      "gap" | "developing" | "strong";
  };
}

export interface InsightResult {
  critical: Insight | null;  // priority 1 — the hardest truth
  positive: Insight | null;  // priority 2 — a genuine positive
}

// ── Engagement metrics ────────────────────────────────────────────────────

/**
 * Derived time metrics computed from engagement telemetry events.
 * Consumed by time-aware insight rules; pre-computed once per
 * generateInsights() call so no rule needs to repeat the work.
 *
 * For sessions recorded before the activity tracker was introduced,
 * computeSessionActivity() falls back to treating all wall-clock time
 * as active, so existing rule behaviour is fully preserved.
 */
export interface SessionMetrics {
  /** Minutes the user was actively coding (window focused + recent activity). */
  activeMin:      number;
  /** Minutes classified as idle (window blurred or inactivity > 30 s). */
  idleMin:        number;
  /** Number of times the window lost focus during the session. */
  focusLossCount: number;
}

/**
 * Pre-computed engagement context threaded into time-aware rule functions.
 * Built once per generateInsights() call; rules that don't need it continue
 * to accept only InsightInput.
 */
interface InsightContext {
  /** Session-level activity totals (activeMin, idleMin, focusLossCount). */
  metrics:  SessionMetrics;
  /**
   * Sorted list of active time segments for the session.
   * Pass to activeMsInRange() to compute active time within any sub-interval
   * (e.g. between two consecutive run events) without additional DB queries.
   */
  segments: ActiveSegment[];
}

function deriveContext(input: InsightInput): InsightContext {
  const activity = computeSessionActivity(input.events, input.session);
  const metrics: SessionMetrics = {
    activeMin:      activity.activeSeconds / 60,
    idleMin:        activity.idleSeconds   / 60,
    focusLossCount: activity.focusLossCount,
  };
  const segments = buildActiveSegments(input.events, input.session);
  return { metrics, segments };
}

// ── Code change metric ────────────────────────────────────────────────────

/**
 * Lightweight regex-based Python lexer.
 *
 * Patterns are tried left-to-right; the first match wins. Order is
 * significant: longer/more-specific patterns must precede general ones.
 * Comments and whitespace are consumed but not included in the token list.
 * Unrecognised characters are skipped one position at a time so the function
 * never throws on syntax-invalid (e.g. mid-edit) code.
 */
const PY_TOKEN_RES: Array<[RegExp, boolean]> = [
  // Triple-quoted strings (must come before single-quoted)
  [/^(?:"""[\s\S]*?"""|'''[\s\S]*?''')/,                              true],
  // Single/double-quoted strings (escaped quotes handled via \\.)
  [/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,                       true],
  // Comments — skip to end of line
  [/^#[^\n]*/,                                                        false],
  // Whitespace — skip
  [/^[ \t\r\n]+/,                                                     false],
  // Numeric literals: hex, octal, binary, float, int (before identifiers)
  [/^(?:0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|\d+\.?\d*(?:[eE][+-]?\d+)?)/,  true],
  // Identifiers and keywords (keywords are kept as-is for exact diffing)
  [/^[A-Za-z_]\w*/,                                                   true],
  // Operators: 3-char augmented first, then 2-char, then 1-char
  [/^(?:\*\*=|\/\/=|<<=|>>=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|->|:=|\*\*|\/\/|==|!=|<=|>=|<<|>>|[+\-*/%&|^~<>=!@])/,  true],
  // Delimiters
  [/^[()[\]{};:.,]/,                                                  true],
];

function tokenizePython(code: string): string[] {
  const tokens: string[] = [];
  let pos = 0;
  const len = code.length;

  while (pos < len) {
    const slice = code.slice(pos);
    let matched = false;

    for (const [re, include] of PY_TOKEN_RES) {
      const m = re.exec(slice);
      if (m) {
        if (include) tokens.push(m[0]);
        pos += m[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) pos++; // skip unrecognised character (never throws)
  }

  return tokens;
}

/**
 * Classic two-row Levenshtein edit distance on token sequences.
 * O(n·m) time, O(m) space. For typical challenge solutions (20–200 tokens)
 * this runs in under a millisecond.
 */
function tokenEditDistance(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const curr = new Array<number>(b.length + 1);
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(prev[j + 1] + 1, curr[j] + 1, prev[j] + cost);
    }
    prev = curr;
  }

  return prev[b.length];
}

/**
 * Fallback line-set ratio: fraction of non-shared trimmed non-empty lines.
 * Used when both snippets tokenize to fewer than 2 tokens (pathologically
 * short or empty inputs).
 */
function fallbackChangeRatio(codeA: string, codeB: string): number {
  const linesA = codeA.split("\n").filter((l) => l.trim());
  const linesB = codeB.split("\n").filter((l) => l.trim());
  const total  = Math.max(linesA.length, linesB.length, 1);
  const setA   = new Set(linesA);
  const same   = linesB.filter((l) => setA.has(l)).length;
  return 1 - same / total;
}

/**
 * Compute the fraction of tokens that changed between two Python code strings.
 * Returns a value in [0, 1]: 0 = identical, 1 = completely different.
 *
 * Primary path: token Levenshtein edit distance / max(tokenCount_A, tokenCount_B).
 * Fallback: line-set ratio (triggered when both snippets have < 2 tokens).
 */
function codeChangeRatio(codeA: string, codeB: string): number {
  try {
    const tokA = tokenizePython(codeA);
    const tokB = tokenizePython(codeB);

    const total = Math.max(tokA.length, tokB.length);
    if (total === 0) return 0;

    if (tokA.length < 2 && tokB.length < 2) {
      return fallbackChangeRatio(codeA, codeB);
    }

    return tokenEditDistance(tokA, tokB) / total;
  } catch {
    return fallbackChangeRatio(codeA, codeB);
  }
}

/**
 * Return the number of tokens in a Python code string.
 * Falls back to non-empty line count if tokenization fails.
 */
function tokenCount(code: string): number {
  try {
    return tokenizePython(code).length;
  } catch {
    return code.split("\n").filter((l) => l.trim()).length;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function eventsOfType(events: InsightEvent[], type: string): InsightEvent[] {
  return events.filter((e) => e.type === type).sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}

/**
 * Returns all code-execution events — both `run` and `submit` — sorted
 * chronologically. Each event in the returned list is guaranteed to carry
 * `metadata.runType` ("run" | "submit") so callers can distinguish them
 * without inspecting `event.type`. For events persisted before the runType
 * flag was introduced, the type is inferred from `event.type`.
 */
function runLikeEvents(events: InsightEvent[]): InsightEvent[] {
  const withType = (e: InsightEvent, runType: "run" | "submit"): InsightEvent => ({
    ...e,
    metadata: { runType, ...e.metadata },
  });

  const runs    = eventsOfType(events, "run").map((e) => withType(e, "run"));
  const submits = eventsOfType(events, "submit").map((e) => withType(e, "submit"));

  return [...runs, ...submits].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}

function minutes(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

function seconds(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 1_000;
}

// ── Observation checkers ──────────────────────────────────────────────────

/**
 * 1. Reading Time
 * Time from session start to first keystroke is too short for the problem length.
 */
function checkReadingTime(input: InsightInput): Insight | null {
  if (input.session.checkinPreWork === "mind") return null; // suppressed

  const fk = eventsOfType(input.events, "first_keystroke")[0];
  if (!fk) return null;

  const readSec   = seconds(input.session.startedAt, fk.occurredAt);
  const threshold = input.problem.wordCount < 100 ? 30
    : input.problem.wordCount <= 250 ? 60 : 90;

  if (readSec >= threshold) return null;

  return {
    observation: "reading_time",
    message: `You spent ${Math.round(readSec)} seconds on the problem before coding. That's not enough time to understand it properly. Most bugs in this kind of problem start with a misread statement or a missed constraint. Read the problem again right now — see if anything in your solution actually addressed what was asked.`,
    evidence: {
      readSeconds:      Math.round(readSec),
      thresholdSeconds: threshold,
      wordCount:        input.problem.wordCount,
    },
  };
}

/**
 * 2. Planning Before Coding — negative case (no planning).
 * Checks first snapshot: if first 5 meaningful lines are NOT comments.
 *
 * Duration gate now uses ctx.metrics.activeMin (active engagement time) so
 * a session where the user was away for most of the clock time does not
 * incorrectly trigger this rule. For legacy sessions without engagement
 * telemetry, activeMin equals wall-clock session duration (no behaviour change).
 */
function checkNoPlanning(input: InsightInput, ctx: InsightContext): Insight | null {
  if (input.session.checkinPreWork === "paper") return null; // suppressed

  const snap = eventsOfType(input.events, "snapshot")[0];
  if (!snap) return null;

  const code    = String(snap.metadata.code_content ?? "");
  const lines   = code.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("def ") && !l.startsWith("import ") && !l.startsWith("pass"));
  if (lines.length === 0) return null;

  const first5 = lines.slice(0, 5);
  const commentCount = first5.filter((l) => l.startsWith("#")).length;
  const isMultiWordComment = first5.some((l) => l.startsWith("#") && l.replace(/^#\s*/, "").split(/\s+/).length > 2);

  // Planning detected = 3+ of first 5 meaningful lines are descriptive comments
  if (commentCount >= 3 && isMultiWordComment) return null;

  // Only fire if session was significant (> 10 active min or had 3+ runs).
  const { activeMin } = ctx.metrics;
  const runCount      = eventsOfType(input.events, "run").length;
  if (activeMin < 10 && runCount < 3) return null;

  const codeLines = first5.filter((l) => !l.startsWith("#")).length;
  return {
    observation: "no_planning",
    message: `You went straight to code without writing out your approach. That's fine for problems you already know. For anything that took you over 20 minutes or required a restart — ask yourself honestly: did you know what you were going to do before you started writing? Three lines of comments describing the steps would have made that visible earlier.`,
    evidence: {
      commentLines: commentCount,
      codeLines,
      activeMin:    Math.round(ctx.metrics.activeMin),
      runCount:     eventsOfType(input.events, "run").length,
    },
  };
}

/**
 * 3. Paste Detection
 * A paste event inserts > 120 chars AND accounts for > 40% of final code.
 */
function checkPasteDetection(input: InsightInput): Insight | null {
  const pasteEvents  = eventsOfType(input.events, "paste");
  const submitEvent  = eventsOfType(input.events, "submit")[0];
  if (!submitEvent || pasteEvents.length === 0) return null;

  const finalLen = Number(submitEvent.metadata.code_length ?? 0);
  if (finalLen === 0) return null;

  for (const pe of pasteEvents) {
    const charsPasted = Number(pe.metadata.chars_pasted ?? 0);
    if (charsPasted > 120 && charsPasted > 0.4 * finalLen) {
      return {
        observation: "paste_detected",
        message: `A significant portion of this solution was pasted in. If that was your own code — fine. If it wasn't, you didn't solve this problem. Open it again and write it from scratch without references. That's the only way to find out if you actually understand it.`,
        evidence: {
          pastedChars:     charsPasted,
          finalCodeLength: finalLen,
          pasteRatio:      Math.round((charsPasted / finalLen) * 100) / 100,
        },
      };
    }
  }
  return null;
}

/**
 * 4. Too Infrequent Running
 * Active session > 20 min with < 2 executions, OR active gap > 20 min between
 * consecutive executions. Both `run` and `submit` events count as executions.
 *
 * Time measurements use active engagement time (ctx) rather than wall-clock
 * duration so periods where the window was blurred or the user was idle do
 * not inflate the perceived gap. For legacy sessions without engagement
 * telemetry, active time equals wall-clock time (no behaviour change).
 *
 * Edge-case visibility is unaffected: checkEdgeCaseBlindness reads directly
 * from eventsOfType("submit") and is never passed the merged list.
 */
function checkInfrequentRunning(input: InsightInput, ctx: InsightContext): Insight | null {
  if (input.session.checkinInterrupted) return null; // suppressed

  const executions = runLikeEvents(input.events); // run + submit, time-ordered
  const { activeMin, segments } = { activeMin: ctx.metrics.activeMin, segments: ctx.segments };

  if (activeMin > 20 && executions.length < 2) {
    return {
      observation: "infrequent_running",
      message: `You were actively coding for ${Math.round(activeMin)} minutes before running your code. Errors caught early are easier to fix than errors buried in 50 lines. You don't need a complete solution to run it — a partial function with a print statement tells you more than finished code that fails silently.`,
      evidence: {
        activeMin:      Math.round(activeMin),
        executionCount: executions.length,
      },
    };
  }

  for (let i = 1; i < executions.length; i++) {
    const activeGapMin = activeMsInRange(
      segments,
      executions[i - 1].occurredAt.getTime(),
      executions[i].occurredAt.getTime(),
    ) / 60_000;

    if (activeGapMin > 20) {
      return {
        observation: "infrequent_running",
        message: `You had ${Math.round(activeGapMin)} active minutes between two runs. Errors caught early are easier to fix than errors buried in 50 lines. You don't need a complete solution to run it — a partial function with a print statement tells you more than finished code that fails silently.`,
        evidence: {
          activeGapMinutes: Math.round(activeGapMin),
          gapIndex:         i,
        },
      };
    }
  }
  return null;
}

/**
 * 5. Restart Detection
 * Token count drops below 35% of the previous snapshot's token count within
 * 90 seconds. Using token count (derived from code_content) rather than raw
 * char_count avoids false positives from whitespace-only reformatting: a
 * re-indented block changes many characters but very few tokens.
 *
 * Guard: previous snapshot must have at least 10 tokens (≈ a few lines of
 * real code) to filter out resets during the first seconds of typing.
 */
function checkRestart(input: InsightInput): Insight | null {
  const snaps = eventsOfType(input.events, "snapshot");
  if (snaps.length < 2) return null;

  for (let i = 1; i < snaps.length; i++) {
    const prevCode    = String(snaps[i - 1].metadata.code_content ?? "");
    const currCode    = String(snaps[i].metadata.code_content ?? "");
    const secDiff     = seconds(snaps[i - 1].occurredAt, snaps[i].occurredAt);
    const prevTokens  = tokenCount(prevCode);
    const currTokens  = tokenCount(currCode);

    if (prevTokens >= 10 && currTokens < 0.35 * prevTokens && secDiff <= 90) {
      return {
        observation: "restart",
        message: `You deleted your code and started over. Sometimes that's the right call. More often, it's avoidance — starting fresh is easier than figuring out what went wrong. Next time you want to restart, spend 5 minutes debugging what you have first. You might not need to.`,
        evidence: {
          prevTokenCount: prevTokens,
          currTokenCount: currTokens,
          collapseRatio:  Math.round((currTokens / Math.max(prevTokens, 1)) * 100) / 100,
          secondsElapsed: Math.round(secDiff),
        },
      };
    }
  }
  return null;
}

/**
 * 6. Syntax-Heavy Session
 * SyntaxError / IndentationError / TabError ≥ 60% of all errors AND ≥ 3 syntax errors.
 */
function checkSyntaxHeavy(input: InsightInput): Insight | null {
  const SYNTAX_TYPES = new Set(["SyntaxError", "IndentationError", "TabError"]);
  const runs = eventsOfType(input.events, "run");
  const errorRuns  = runs.filter((r) => r.metadata.error_type);
  const syntaxRuns = errorRuns.filter((r) => SYNTAX_TYPES.has(String(r.metadata.error_type ?? "")));

  if (syntaxRuns.length < 3) return null;
  const syntaxRatio = syntaxRuns.length / Math.max(errorRuns.length, 1);
  if (syntaxRatio < 0.6) return null;

  return {
    observation: "syntax_heavy",
    message: `Most of your errors this session were syntax errors — indentation, colons, brackets. Not wrong logic. Not a bad approach. Python's syntax got in the way. Be direct with yourself about this: it's a fluency gap, and it's fixable. Deliberate practice — writing common constructs from memory until they're automatic — will close it. Solving more problems won't.`,
    evidence: {
      syntaxRuns:     syntaxRuns.length,
      totalErrorRuns: errorRuns.length,
      syntaxRatio:    Math.round(syntaxRatio * 100) / 100,
    },
  };
}

/**
 * 7. Logic-Heavy Session
 * 2+ runs where execution completed without exception AND at least one test failed.
 */
function checkLogicHeavy(input: InsightInput): Insight | null {
  const runs = eventsOfType(input.events, "run");
  const logicRuns = runs.filter((r) => {
    const noError    = !r.metadata.error_type;
    const someTests  = Number(r.metadata.total_count ?? 0) > 0;
    const notAllPass = !r.metadata.all_passed;
    return noError && someTests && notAllPass;
  });

  if (logicRuns.length < 2) return null;

  return {
    observation: "logic_heavy",
    message: `Your code ran without crashing but gave wrong answers. Your Python syntax isn't the problem. The problem is in how you thought through the solution. Trace through your code manually with a simple input — write down what each variable holds at each step. Find exactly where what you expected and what actually happened diverged.`,
    evidence: {
      logicRuns: logicRuns.length,
      totalRuns: runs.length,
    },
  };
}

/**
 * 8. Specific Runtime Errors (Repeated)
 * The same error class appears in 2+ separate runs.
 */
const NAMED_ERROR_MESSAGES: Record<string, (n: number) => string> = {
  IndexError: (n) => `You hit an IndexError ${n} times. This is specific: somewhere your code assumes a list is longer than it is, or a loop runs one step past the end. Add print(len(your_list)) before the line that crashes. Don't guess — check what's actually there.`,
  TypeError:  (n) => `A TypeError came up ${n} times. Your code is using a value as the wrong type. Print the variable and type(variable) right before the crash. The fix is usually one line once you see what Python actually has.`,
  NameError:  (n) => `NameError appeared ${n} times. Python can't find a variable — usually a typo or using it before it's been assigned. The error message tells you exactly which name it can't find. Check spelling, then check where that variable is first defined.`,
};

function checkRepeatedError(input: InsightInput): Insight | null {
  const runs = eventsOfType(input.events, "run");
  const counts = new Map<string, number>();

  for (const r of runs) {
    const errType = String(r.metadata.error_type ?? "");
    if (errType) counts.set(errType, (counts.get(errType) ?? 0) + 1);
  }

  // Priority: IndexError > TypeError > NameError > others
  for (const [errType, makeMsgFn] of Object.entries(NAMED_ERROR_MESSAGES)) {
    const n = counts.get(errType) ?? 0;
    if (n >= 2) return { observation: "repeated_error", message: makeMsgFn(n), evidence: { errorType: errType, occurrences: n } };
  }

  // Any other error type repeated
  for (const [errType, n] of counts) {
    if (n >= 2 && !NAMED_ERROR_MESSAGES[errType]) {
      return {
        observation: "repeated_error",
        message: `${errType} appeared ${n} times. The error message is telling you something specific — read it carefully and trace back to the exact line it points to.`,
        evidence: { errorType: errType, occurrences: n },
      };
    }
  }
  return null;
}

/**
 * 9. Edge Case Blindness
 * First 60%+ of non-edge tests pass AND at least one edge test fails.
 */
function checkEdgeCaseBlindness(input: InsightInput): Insight | null {
  const submitEvent = eventsOfType(input.events, "submit")[0];
  if (!submitEvent) return null;

  const testResults = submitEvent.metadata.test_results as Array<{ passed: boolean; is_edge_case: boolean }> | undefined;
  if (!testResults || testResults.length === 0) return null;

  const nonEdge    = testResults.filter((r) => !r.is_edge_case);
  const edgeCases  = testResults.filter((r) => r.is_edge_case);
  if (edgeCases.length === 0) return null;

  const nonEdgePassed = nonEdge.filter((r) => r.passed).length;
  const edgeFailed    = edgeCases.filter((r) => !r.passed).length;

  const nonEdgePassRate = nonEdge.length > 0 ? nonEdgePassed / nonEdge.length : 0;

  if (nonEdgePassRate >= 0.6 && edgeFailed >= 1) {
    return {
      observation: "edge_case_blindness",
      message: `You solved the main cases. The edge cases failed. This is one of the most consistent patterns in placement tests, and it's fixable with one habit: before submitting, ask — what if the input is empty? What if it has one element? What if all values are the same? Those three questions catch most edge cases. Start asking them now.`,
      evidence: {
        nonEdgePassed:    nonEdgePassed,
        nonEdgeTotal:     nonEdge.length,
        edgeFailed:       edgeFailed,
        edgeTotal:        edgeCases.length,
        nonEdgePassRate:  Math.round(nonEdgePassRate * 100) / 100,
      },
    };
  }
  return null;
}

/**
 * 10. Stuck Loop
 * 3+ consecutive failed runs where the token-level changeRatio between each
 * consecutive pair is < 0.10 (fewer than 10% of tokens changed).
 *
 * Using token edit distance instead of absolute character length avoids two
 * failure modes of the old heuristic:
 *   • Short solutions: 15 chars was 25%+ of the code — almost anything fired.
 *   • Long solutions: re-indenting a block changes many chars but zero tokens.
 */
function checkStuckLoop(input: InsightInput): Insight | null {
  const runs = eventsOfType(input.events, "run");
  if (runs.length < 3) return null;

  let streak          = 1;
  let lastChangeRatio = 0;
  let prevCode        = String(runs[0].metadata.code_content ?? "");

  for (let i = 1; i < runs.length; i++) {
    const run         = runs[i];
    const currentCode = String(run.metadata.code_content ?? "");
    const changeRatio = codeChangeRatio(prevCode, currentCode);
    const isFailing   = !run.metadata.all_passed;

    if (isFailing && changeRatio < 0.10) {
      streak++;
      lastChangeRatio = changeRatio;
      if (streak >= 3) {
        return {
          observation: "stuck_loop",
          message: `You ran your code ${streak} times in a row without meaningful changes. Running broken code again doesn't fix it. If the output isn't what you expected, the problem is in the code — not in how many times you run it. Add a print statement. Ask the code what it's actually doing at the point of failure.`,
          evidence: {
            consecutiveFailedRuns: streak,
            changeRatio:           Math.round(lastChangeRatio * 100) / 100,
          },
        };
      }
    } else {
      streak = 1;
    }
    prevCode = currentCode;
  }
  return null;
}

/**
 * 12. Long Time Stuck on One Error
 * > 15 active min between a failed run and the next run, AND token changeRatio
 * < 0.15 (fewer than 15% of tokens changed across that gap).
 *
 * The gap is measured in active engagement time (ctx.segments) so periods
 * where the window was blurred or the user stepped away don't count against
 * them. A 20-minute wall-clock gap where 18 minutes were blurred resolves to
 * only 2 active minutes — correctly below the 15-minute threshold. For legacy
 * sessions, active gap equals wall-clock gap (no behaviour change).
 */
function checkLongTimeStuck(input: InsightInput, ctx: InsightContext): Insight | null {
  if (input.session.checkinInterrupted) return null; // suppressed

  const runs = eventsOfType(input.events, "run");

  for (let i = 0; i < runs.length - 1; i++) {
    const run     = runs[i];
    const nextRun = runs[i + 1];
    if (run.metadata.all_passed) continue;

    const activeGapMin = activeMsInRange(
      ctx.segments,
      run.occurredAt.getTime(),
      nextRun.occurredAt.getTime(),
    ) / 60_000;

    const changeRatio = codeChangeRatio(
      String(run.metadata.code_content ?? ""),
      String(nextRun.metadata.code_content ?? ""),
    );

    if (activeGapMin > 15 && changeRatio < 0.15) {
      return {
        observation: "long_stuck",
        message: `You were stuck on one error for ${Math.round(activeGapMin)} active minutes. After 10 minutes with no progress, staring at the same code stops being useful. Pick one of three things: re-read the error message word by word — it often tells you exactly what's wrong. Add a print statement to see what's actually in your variables. Or step away for 10 minutes. The answer rarely comes from staring harder.`,
        evidence: {
          activeGapMinutes: Math.round(activeGapMin),
          changeRatio:      Math.round(changeRatio * 100) / 100,
        },
      };
    }
  }
  return null;
}

// ── Positive observations ─────────────────────────────────────────────────

/**
 * 2. Planning Before Coding — positive case.
 */
function checkPlanningDetected(input: InsightInput): Insight | null {
  const snap = eventsOfType(input.events, "snapshot")[0];
  if (!snap) return null;

  const code    = String(snap.metadata.code_content ?? "");
  const lines   = code.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("def ") && !l.startsWith("import ") && !l.startsWith("pass"));
  const first5  = lines.slice(0, 5);
  const commentCount       = first5.filter((l) => l.startsWith("#")).length;
  const isMultiWordComment = first5.some((l) => l.startsWith("#") && l.replace(/^#\s*/, "").split(/\s+/).length > 2);

  if (commentCount >= 3 && isMultiWordComment) {
    return {
      observation: "planning_detected",
      message: `You described your approach before writing code. That kind of planning tends to produce cleaner first attempts. Keep doing it, especially on problems that feel uncertain.`,
      evidence: {
        commentCount,
        first5LineCount: first5.length,
      },
    };
  }
  return null;
}

/**
 * 11. Print Statement Usage — positive.
 * After a failed run, a new print() appears before the next run.
 */
function checkPrintDebugging(input: InsightInput): Insight | null {
  const runs = eventsOfType(input.events, "run");

  for (let i = 0; i < runs.length - 1; i++) {
    const run     = runs[i];
    const nextRun = runs[i + 1];
    if (run.metadata.all_passed) continue;

    const prevCode = String(run.metadata.code_content ?? "");
    const nextCode = String(nextRun.metadata.code_content ?? "");
    const prevPrintCount = (prevCode.match(/print\(/g) ?? []).length;
    const nextPrintCount = (nextCode.match(/print\(/g) ?? []).length;

    if (nextPrintCount > prevPrintCount) {
      return {
        observation: "print_debugging",
        message: `After hitting an error, you added print statements to investigate. That's the right move — you asked the code a direct question instead of guessing at it. Keep doing this.`,
        evidence: {
          prevPrintCount,
          nextPrintCount,
          newPrints: nextPrintCount - prevPrintCount,
        },
      };
    }
  }
  return null;
}

// ── Behavior focus mapping ────────────────────────────────────────────────

/**
 * Maps each observation slug to a single recommended habit for the learner's
 * next session. Applied centrally in generateInsights() so individual rule
 * functions remain unmodified.
 *
 * Keys must match the `observation` slug returned by each checker function.
 * Unlisted observations produce no behaviorFocus (field is optional).
 */
export const BEHAVIOR_FOCUS: Record<string, string> = {
  reading_time:       "Spend more time reading the problem before typing code.",
  no_planning:        "Write a quick outline or comment plan before coding.",
  syntax_heavy:       "Slow down and check syntax carefully before running.",
  logic_heavy:        "Trace your logic with a small example before coding.",
  repeated_error:     "If the same error appears multiple times, step back and inspect the root cause.",
  stuck_loop:         "Try reconsidering your approach instead of making small edits.",
  long_stuck:         "If you haven't made progress in a while, step away and rethink the strategy.",
  restart:            "Before deleting everything, review what parts of your code were working.",
  paste_detected:     "Try implementing the logic yourself before pasting large blocks of code.",
  infrequent_running: "Run your code after each logical change to catch issues early.",
  edge_case_blindness: "After solving the main case, think about edge cases like empty input or limits.",
  planning_detected:  "Continue planning your solution before coding.",
  print_debugging:    "Using print statements to inspect variables can help isolate bugs.",
};

/** Attach behaviorFocus to an insight if a mapping exists for its observation. */
function withBehaviorFocus(insight: Insight): Insight {
  const focus = BEHAVIOR_FOCUS[insight.observation];
  if (!focus) return insight;
  return { ...insight, behaviorFocus: focus };
}

/**
 * Attach conceptContext to an insight when the problem's concept tags include
 * at least one "gap" or "developing" area.
 *
 * Priority: "gap" is preferred over "developing"; "strong" concepts are skipped
 * entirely — they are not worth surfacing as a concern.
 *
 * Called after withBehaviorFocus so enrichment steps remain independent.
 */
function withConceptContext(
  insight:     Insight,
  conceptGaps: ConceptGapInfo[] | undefined,
): Insight {
  if (!conceptGaps || conceptGaps.length === 0) return insight;

  // Find the most severe non-strong concept. "gap" takes priority over "developing".
  const relevant = conceptGaps.filter((g) => g.status === "gap" || g.status === "developing");
  if (relevant.length === 0) return insight;

  const top = relevant.find((g) => g.status === "gap") ?? relevant[0];

  return {
    ...insight,
    conceptContext: { conceptSlug: top.conceptSlug, status: top.status },
  };
}

// ── Main engine ───────────────────────────────────────────────────────────

/**
 * Run all per-session observations in priority order and return up to two:
 * one critical (the hardest truth) and one positive (a genuine win).
 */
export function generateInsights(input: InsightInput): InsightResult {
  // Build engagement context once — O(n) over the event stream.
  // ctx.metrics supplies session-level active/idle time; ctx.segments
  // enables per-interval active-time queries for inter-event gap rules.
  const ctx = deriveContext(input);

  // Priority order per spec (most important first).
  // Rules that depend on active engagement time receive ctx as a second
  // argument; all other rules keep their original (input-only) signature.
  const criticalChecks: Array<(i: InsightInput) => Insight | null> = [
    checkSyntaxHeavy,
    checkLogicHeavy,
    checkEdgeCaseBlindness,
    checkRepeatedError,
    checkStuckLoop,
    (i) => checkLongTimeStuck(i, ctx),
    checkRestart,
    checkPasteDetection,
    (i) => checkNoPlanning(i, ctx),
    (i) => checkInfrequentRunning(i, ctx),
    checkReadingTime,
  ];

  const positiveChecks: Array<(i: InsightInput) => Insight | null> = [
    checkPlanningDetected,
    checkPrintDebugging,
  ];

  const conceptGaps = input.problem.conceptGaps;

  let critical: Insight | null = null;
  for (const check of criticalChecks) {
    const result = check(input);
    if (result) {
      critical = withConceptContext(withBehaviorFocus(result), conceptGaps);
      break;
    }
  }

  let positive: Insight | null = null;
  // Only show positive if it's a different observation than critical
  for (const check of positiveChecks) {
    const result = check(input);
    if (result && result.observation !== critical?.observation) {
      positive = withConceptContext(withBehaviorFocus(result), conceptGaps);
      break;
    }
  }

  return { critical, positive };
}
