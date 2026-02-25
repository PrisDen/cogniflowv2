export type EventType = "first_keystroke" | "paste" | "snapshot" | "run" | "submit";

export interface TestCaseResult {
  testCaseId:   string;
  passed:       boolean;
  isEdgeCase:   boolean;
  actualOutput: string | null;
  description:  string | null;
}

export interface RunResponse {
  errorType:       string | null;
  errorMessage:    string | null;
  executionTimeMs: number;
  allPassed:       boolean;
  testResults:     TestCaseResult[];
}
