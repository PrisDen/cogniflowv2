/**
 * Cogniflow Insight Engine — per-session rule-based observations.
 * Implements observations 1–12 from the insight-layer-spec.
 * Observations 13–15 are cross-session and live in the Gap Tracker.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface InsightEvent {
  type:       string;
  occurredAt: Date;
  metadata:   Record<string, unknown>;
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
  problem: { wordCount: number };
  events:  InsightEvent[];
}

export interface Insight {
  observation: string;  // slug key
  message:     string;  // exact text shown to the user
}

export interface InsightResult {
  critical: Insight | null;  // priority 1 — the hardest truth
  positive: Insight | null;  // priority 2 — a genuine positive
}

// ── Helpers ────────────────────────────────────────────────────────────────

function eventsOfType(events: InsightEvent[], type: string): InsightEvent[] {
  return events.filter((e) => e.type === type).sort(
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
  };
}

/**
 * 2. Planning Before Coding — negative case (no planning).
 * Checks first snapshot: if first 5 meaningful lines are NOT comments.
 */
function checkNoPlanning(input: InsightInput): Insight | null {
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

  // Only fire if session was significant (> 10 min or had restarts)
  const sessionMin = minutes(input.session.startedAt, input.session.endedAt ?? new Date());
  const runCount   = eventsOfType(input.events, "run").length;
  if (sessionMin < 10 && runCount < 3) return null;

  return {
    observation: "no_planning",
    message: `You went straight to code without writing out your approach. That's fine for problems you already know. For anything that took you over 20 minutes or required a restart — ask yourself honestly: did you know what you were going to do before you started writing? Three lines of comments describing the steps would have made that visible earlier.`,
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
      };
    }
  }
  return null;
}

/**
 * 4. Too Infrequent Running
 * Session > 20 min with < 2 runs, OR any gap > 20 min between consecutive runs.
 */
function checkInfrequentRunning(input: InsightInput): Insight | null {
  if (input.session.checkinInterrupted) return null; // suppressed

  const runs       = eventsOfType(input.events, "run");
  const sessionMin = minutes(input.session.startedAt, input.session.endedAt ?? new Date());

  if (sessionMin > 20 && runs.length < 2) {
    return {
      observation: "infrequent_running",
      message: `You wrote for ${Math.round(sessionMin)} minutes before running your code. Errors caught early are easier to fix than errors buried in 50 lines. You don't need a complete solution to run it — a partial function with a print statement tells you more than finished code that fails silently.`,
    };
  }

  for (let i = 1; i < runs.length; i++) {
    const gapMin = minutes(runs[i - 1].occurredAt, runs[i].occurredAt);
    if (gapMin > 20) {
      return {
        observation: "infrequent_running",
        message: `You went ${Math.round(gapMin)} minutes between two runs. Errors caught early are easier to fix than errors buried in 50 lines. You don't need a complete solution to run it — a partial function with a print statement tells you more than finished code that fails silently.`,
      };
    }
  }
  return null;
}

/**
 * 5. Restart Detection
 * A snapshot drops below 35% of the previous one within 60 seconds.
 */
function checkRestart(input: InsightInput): Insight | null {
  const snaps = eventsOfType(input.events, "snapshot");
  if (snaps.length < 2) return null;

  for (let i = 1; i < snaps.length; i++) {
    const prev    = Number(snaps[i - 1].metadata.char_count ?? 0);
    const curr    = Number(snaps[i].metadata.char_count ?? 0);
    const secDiff = seconds(snaps[i - 1].occurredAt, snaps[i].occurredAt);

    if (prev > 50 && curr < 0.35 * prev && secDiff <= 90) {
      return {
        observation: "restart",
        message: `You deleted your code and started over. Sometimes that's the right call. More often, it's avoidance — starting fresh is easier than figuring out what went wrong. Next time you want to restart, spend 5 minutes debugging what you have first. You might not need to.`,
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
  if (syntaxRuns.length / Math.max(errorRuns.length, 1) < 0.6) return null;

  return {
    observation: "syntax_heavy",
    message: `Most of your errors this session were syntax errors — indentation, colons, brackets. Not wrong logic. Not a bad approach. Python's syntax got in the way. Be direct with yourself about this: it's a fluency gap, and it's fixable. Deliberate practice — writing common constructs from memory until they're automatic — will close it. Solving more problems won't.`,
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
    if (n >= 2) return { observation: "repeated_error", message: makeMsgFn(n) };
  }

  // Any other error type repeated
  for (const [errType, n] of counts) {
    if (n >= 2 && !NAMED_ERROR_MESSAGES[errType]) {
      return {
        observation: "repeated_error",
        message: `${errType} appeared ${n} times. The error message is telling you something specific — read it carefully and trace back to the exact line it points to.`,
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
    };
  }
  return null;
}

/**
 * 10. Stuck Loop
 * 3+ consecutive failed runs with < 15 char difference between each.
 */
function checkStuckLoop(input: InsightInput): Insight | null {
  const runs = eventsOfType(input.events, "run");
  if (runs.length < 3) return null;

  let streak   = 1;
  let prevCode = String(runs[0].metadata.code_content ?? "");

  for (let i = 1; i < runs.length; i++) {
    const run         = runs[i];
    const currentCode = String(run.metadata.code_content ?? "");
    const charDiff    = Math.abs(currentCode.length - prevCode.length);
    const isFailing   = !run.metadata.all_passed;

    if (isFailing && charDiff < 15) {
      streak++;
      if (streak >= 3) {
        return {
          observation: "stuck_loop",
          message: `You ran your code ${streak} times in a row without meaningful changes. Running broken code again doesn't fix it. If the output isn't what you expected, the problem is in the code — not in how many times you run it. Add a print statement. Ask the code what it's actually doing at the point of failure.`,
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
 * > 15 min between a failed run and the next run with < 30 char change.
 */
function checkLongTimeStuck(input: InsightInput): Insight | null {
  if (input.session.checkinInterrupted) return null; // suppressed

  const runs = eventsOfType(input.events, "run");

  for (let i = 0; i < runs.length - 1; i++) {
    const run     = runs[i];
    const nextRun = runs[i + 1];
    if (run.metadata.all_passed) continue;

    const gapMin  = minutes(run.occurredAt, nextRun.occurredAt);
    const charDiff = Math.abs(
      String(nextRun.metadata.code_content ?? "").length -
      String(run.metadata.code_content ?? "").length,
    );

    if (gapMin > 15 && charDiff < 30) {
      return {
        observation: "long_stuck",
        message: `You were stuck on one error for ${Math.round(gapMin)} minutes. After 10 minutes with no progress, staring at the same code stops being useful. Pick one of three things: re-read the error message word by word — it often tells you exactly what's wrong. Add a print statement to see what's actually in your variables. Or step away for 10 minutes. The answer rarely comes from staring harder.`,
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
      };
    }
  }
  return null;
}

// ── Main engine ───────────────────────────────────────────────────────────

/**
 * Run all per-session observations in priority order and return up to two:
 * one critical (the hardest truth) and one positive (a genuine win).
 */
export function generateInsights(input: InsightInput): InsightResult {
  // Priority order per spec (most important first)
  const criticalChecks = [
    checkSyntaxHeavy,
    checkLogicHeavy,
    checkEdgeCaseBlindness,
    checkRepeatedError,
    checkStuckLoop,
    checkLongTimeStuck,
    checkRestart,
    checkPasteDetection,
    checkNoPlanning,
    checkInfrequentRunning,
    checkReadingTime,
  ];

  const positiveChecks = [
    checkPlanningDetected,
    checkPrintDebugging,
  ];

  let critical: Insight | null = null;
  for (const check of criticalChecks) {
    const result = check(input);
    if (result) { critical = result; break; }
  }

  let positive: Insight | null = null;
  // Only show positive if it's a different observation than critical
  for (const check of positiveChecks) {
    const result = check(input);
    if (result && result.observation !== critical?.observation) {
      positive = result;
      break;
    }
  }

  return { critical, positive };
}
