"use client";

import type { RunResponse } from "@/types/session";

interface OutputPanelProps {
  result:    RunResponse | null;
  isRunning: boolean;
  isSubmit?: boolean;
}

export function OutputPanel({ result, isRunning, isSubmit }: OutputPanelProps) {
  if (isRunning) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
        Running your code…
      </div>
    );
  }

  if (!result) return null;

  const { errorType, errorMessage, testResults, allPassed, executionTimeMs } = result;
  const visibleResults = isSubmit ? testResults : testResults.filter((r) => !r.isEdgeCase);
  const passedCount    = visibleResults.filter((r) => r.passed).length;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-sm">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {allPassed ? (
            <span className="flex items-center gap-1.5 text-[#4ADE80] font-medium">
              <span className="material-symbols-outlined" style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              All {visibleResults.length} tests passed
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[#F87171] font-medium">
              <span className="material-symbols-outlined" style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}>cancel</span>
              {passedCount}/{visibleResults.length} tests passed
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--color-text-muted)]">{executionTimeMs}ms</span>
      </div>

      {/* Error block */}
      {errorType && (
        <div className="mt-1 p-3 bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)] rounded-lg">
          <p className="text-xs font-mono text-[#F87171] font-medium">{errorType}</p>
          {errorMessage && (
            <p className="text-xs font-mono text-[var(--color-text-secondary)] mt-1 whitespace-pre-wrap">{errorMessage}</p>
          )}
        </div>
      )}

      {/* Per-test results */}
      <div className="flex flex-col gap-1.5 mt-1">
        {visibleResults.map((r, i) => (
          <div
            key={r.testCaseId}
            className={[
              "flex flex-col gap-1 p-2.5 rounded-lg border text-xs",
              r.passed
                ? "border-[rgba(74,222,128,0.15)] bg-[rgba(74,222,128,0.05)]"
                : "border-[rgba(248,113,113,0.15)] bg-[rgba(248,113,113,0.05)]",
            ].join(" ")}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`material-symbols-outlined ${r.passed ? "text-[#4ADE80]" : "text-[#F87171]"}`}
                style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}
              >
                {r.passed ? "check_circle" : "cancel"}
              </span>
              <span className={`font-medium ${r.passed ? "text-[#4ADE80]" : "text-[#F87171]"}`}>
                Test {i + 1}{r.description ? ` · ${r.description}` : ""}
              </span>
            </div>

            {!r.passed && r.actualOutput !== null && (
              <div className="ml-5 flex flex-col gap-0.5 font-mono text-[var(--color-text-secondary)]">
                <span>Got: <span className="text-[#F87171]">{r.actualOutput}</span></span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
