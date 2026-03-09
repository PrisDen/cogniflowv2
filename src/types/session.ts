export type EventType =
  | "first_keystroke"
  | "paste"
  | "snapshot"
  | "run"
  | "submit"
  // Engagement telemetry (introduced with activity-tracker instrumentation)
  | "window_focus"
  | "window_blur"
  | "problem_scroll"
  | "editor_activity";

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
