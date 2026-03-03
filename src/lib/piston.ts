import type { TestCaseResult } from "@/types/session";

/**
 * Code execution via Judge0 CE (https://ce.judge0.com).
 * Python 3.12.5 → language_id: 100
 *
 * Public Piston API became whitelist-only in Feb 2026.
 * Judge0 CE's public endpoint has no auth requirement.
 */

// If JUDGE0_API_KEY is set, use the RapidAPI endpoint (reliable, key-gated).
// Otherwise fall back to the public ce.judge0.com endpoint (unreliable from cloud IPs).
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY ?? "";
const JUDGE0_URL     = process.env.JUDGE0_API_URL
  ?? (JUDGE0_API_KEY ? "https://judge0-ce.p.rapidapi.com" : "https://ce.judge0.com");

const PYTHON_LANG  = 100; // Python 3.12.5

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect if the starter code has multiple parameters → use *args unpacking */
function hasMultipleParams(starterCode: string | null): boolean {
  if (!starterCode) return false;
  const match = starterCode.match(/def solution\(([^)]*)\)/);
  if (!match) return false;
  return match[1].split(",").filter((p) => p.trim()).length > 1;
}

/**
 * Build a single Python script that runs all test cases and prints structured
 * output separated by a unique marker. Using base64-encoded inputs avoids all
 * quote-escaping edge cases.
 *
 * stdout format per test case:
 *   ===CF===
 *   OK:<repr of result>       — on success
 *   ERR:<ErrorType>:<message> — on exception
 */
function buildBatchScript(
  userCode: string,
  testCases: Array<{ id: string; input: string }>,
  isMultiArg: boolean,
): string {
  const casesB64 = testCases.map((tc) => [
    tc.id,
    Buffer.from(tc.input, "utf-8").toString("base64"),
  ]);

  const casesJson = JSON.stringify(casesB64);

  return `${userCode}

import ast as _ast, base64 as _b64, json as _json, sys as _sys, io as _io

_MARK = "===CF==="
_MULTI = ${isMultiArg ? "True" : "False"}
_CASES = _json.loads(${JSON.stringify(casesJson)})

for _tc_id, _b64_input in _CASES:
    _decoded = _b64.b64decode(_b64_input).decode("utf-8")
    _capture = _io.StringIO()
    _old_out = _sys.stdout
    _sys.stdout = _capture
    try:
        _parsed = _ast.literal_eval(_decoded)
        if _MULTI:
            _result = solution(*_parsed)
        else:
            _result = solution(_parsed)
        _sys.stdout = _old_out
        print(_MARK)
        print(repr(_result))
    except Exception as _e:
        _sys.stdout = _old_out
        print(_MARK)
        print(f"ERR:{type(_e).__name__}:{str(_e)}")
`;
}

/** Parse the structured stdout back into per-test-case results */
function parseBatchOutput(
  stdout: string,
  testCases: Array<{ id: string; expectedOutput: string; isEdgeCase: boolean; description: string | null }>,
): { results: TestCaseResult[]; errorType: string | null; errorMessage: string | null } {
  const parts = stdout.split("===CF===\n").slice(1);

  let errorType: string | null    = null;
  let errorMessage: string | null = null;

  const results: TestCaseResult[] = testCases.map((tc, i) => {
    const raw = (parts[i] ?? "").trim();

    if (!raw || raw.startsWith("ERR:")) {
      if (raw.startsWith("ERR:") && !errorType) {
        const colonIdx = raw.indexOf(":", 4);
        errorType    = colonIdx > -1 ? raw.slice(4, colonIdx) : raw.slice(4);
        errorMessage = colonIdx > -1 ? raw.slice(colonIdx + 1) : "";
      }
      return {
        testCaseId: tc.id, passed: false, isEdgeCase: tc.isEdgeCase,
        actualOutput: null, description: tc.description,
      };
    }

    const passed = raw === tc.expectedOutput.trim();
    return {
      testCaseId: tc.id, passed, isEdgeCase: tc.isEdgeCase,
      actualOutput: raw, description: tc.description,
    };
  });

  return { results, errorType, errorMessage };
}

// ── Judge0 execution ─────────────────────────────────────────────────────────

interface Judge0Response {
  stdout:         string | null;
  stderr:         string | null;
  compile_output: string | null;
  status:         { id: number; description: string };
  time:           string | null; // seconds as string e.g. "0.042"
}

// Judge0 status IDs that indicate success
const JUDGE0_ACCEPTED = 3;

async function executeViaJudge0(code: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
}> {
  const start = Date.now();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (JUDGE0_API_KEY) {
    headers["X-RapidAPI-Key"]  = JUDGE0_API_KEY;
    headers["X-RapidAPI-Host"] = "judge0-ce.p.rapidapi.com";
  }

  let res: Response;
  try {
    res = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=true`, {
      method:  "POST",
      headers,
      body: JSON.stringify({
        source_code: code,
        language_id: PYTHON_LANG,
        stdin:       "",
        cpu_time_limit:   10,
        wall_time_limit:  15,
        memory_limit:     128000,
      }),
    });
  } catch {
    throw new Error("JUDGE0_UNREACHABLE");
  }

  const executionTimeMs = Date.now() - start;
  if (!res.ok) throw new Error("JUDGE0_ERROR");

  const data = (await res.json()) as Judge0Response;
  const statusId = data.status?.id ?? 0;

  // Compile errors land in compile_output; runtime errors in stderr
  const stderr   = data.compile_output ?? data.stderr ?? "";
  const exitCode = statusId === JUDGE0_ACCEPTED ? 0 : 1;

  return {
    stdout: data.stdout ?? "",
    stderr,
    exitCode,
    executionTimeMs: data.time ? Math.round(parseFloat(data.time) * 1000) : executionTimeMs,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

interface RunInput {
  id:             string;
  input:          string;
  expectedOutput: string;
  isEdgeCase:     boolean;
  description:    string | null;
}

export interface PistonRunResult {
  errorType:       string | null;
  errorMessage:    string | null;
  executionTimeMs: number;
  allPassed:       boolean;
  testResults:     TestCaseResult[];
}

export async function runAgainstTestCases(
  userCode: string,
  starterCode: string | null,
  testCases: RunInput[],
): Promise<PistonRunResult> {
  const isMultiArg = hasMultipleParams(starterCode);
  const script     = buildBatchScript(userCode, testCases, isMultiArg);

  const { stdout, stderr, exitCode, executionTimeMs } = await executeViaJudge0(script);

  // If execution crashed before reaching test loop (syntax error etc.)
  if (exitCode !== 0 && !stdout.includes("===CF===")) {
    const lines      = stderr.trim().split("\n");
    const lastLine   = lines[lines.length - 1] ?? "";
    const colonIdx   = lastLine.indexOf(":");
    const errType    = colonIdx > -1 ? lastLine.slice(0, colonIdx).trim() : "Error";
    const errMessage = colonIdx > -1 ? lastLine.slice(colonIdx + 1).trim() : lastLine;

    return {
      errorType: errType,
      errorMessage: errMessage || stderr.trim(),
      executionTimeMs,
      allPassed: false,
      testResults: testCases.map((tc) => ({
        testCaseId: tc.id, passed: false, isEdgeCase: tc.isEdgeCase,
        actualOutput: null, description: tc.description,
      })),
    };
  }

  const { results, errorType, errorMessage } = parseBatchOutput(stdout, testCases);

  return {
    errorType,
    errorMessage,
    executionTimeMs,
    allPassed: results.every((r) => r.passed),
    testResults: results,
  };
}
