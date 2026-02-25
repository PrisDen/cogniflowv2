"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { ProblemDetail } from "@/types/problem";
import type { RunResponse } from "@/types/session";
import { OutputPanel } from "./OutputPanel";

// Monaco must be loaded client-side only
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface ProblemWorkspaceProps {
  problem: ProblemDetail;
}

export function ProblemWorkspace({ problem }: ProblemWorkspaceProps) {
  const router = useRouter();

  const [code, setCode]           = useState(problem.starterCode ?? "def solution():\n    pass");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [isSubmitResult, setIsSubmitResult] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [showTestCases, setShowTestCases] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const codeRef            = useRef(code);
  const firstKeystrokeFired = useRef(false);
  const editorRef          = useRef<unknown>(null);
  codeRef.current          = code;

  // ── Create session on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/sessions", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ problemId: problem.id }),
    })
      .then((r) => r.json())
      .then((d) => setSessionId(d.id))
      .catch(console.error);
  }, [problem.id]);

  // ── Session timer ────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Snapshot every 30 seconds ────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      postEvent("snapshot", {
        code_content: codeRef.current,
        char_count:   codeRef.current.length,
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────────────────
  const postEvent = useCallback(
    (type: string, metadata: Record<string, unknown> = {}) => {
      if (!sessionId) return;
      fetch(`/api/sessions/${sessionId}/events`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, occurredAt: new Date().toISOString(), metadata }),
      }).catch(console.error);
    },
    [sessionId],
  );

  // ── Editor mount ─────────────────────────────────────────────────────────
  const handleEditorMount = useCallback(
    (editor: { onDidChangeModelContent: (cb: (e: { isFlush: boolean; changes: Array<{ text: string }> }) => void) => void; onDidPaste: (cb: (e: { range: { startLineNumber: number } }) => void) => void; getModel: () => { getValue: () => string; getValueInRange: (r: { startLineNumber: number }) => string } | null }) => {
      editorRef.current = editor;

      editor.onDidChangeModelContent((e) => {
        if (!firstKeystrokeFired.current && !e.isFlush) {
          const typed = e.changes.some((c) => c.text && c.text.length > 0 && c.text.length < 5);
          if (typed) {
            firstKeystrokeFired.current = true;
            postEvent("first_keystroke");
          }
        }
      });

      editor.onDidPaste((e: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }) => {
        const model = editor.getModel();
        if (!model) return;
        const pastedText   = model.getValueInRange(e.range);
        const currentLength = model.getValue().length;
        postEvent("paste", {
          chars_pasted:              pastedText.length,
          total_code_length_at_time: currentLength,
        });
      });
    },
    [postEvent],
  );

  // ── Run ──────────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (isRunning || isSubmitting) return;
    setIsRunning(true);
    setIsSubmitResult(false);
    setRunResult(null);

    const codeAtRun = codeRef.current;

    try {
      const res = await fetch("/api/run", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          problemId:        problem.id,
          code:             codeAtRun,
          includeEdgeCases: false,
        }),
      });
      const data = await res.json() as RunResponse & { error?: string };
      if (!res.ok) {
        const errResult = { errorType: "RunError", errorMessage: data.error ?? "Execution failed.", allPassed: false, executionTimeMs: 0, testResults: [] };
        setRunResult(errResult);
        postEvent("run", { code_content: codeAtRun, code_length: codeAtRun.length, error_type: "RunError", all_passed: false, passed_count: 0, total_count: 0 });
      } else {
        setRunResult(data);
        postEvent("run", {
          code_content:  codeAtRun,
          code_length:   codeAtRun.length,
          error_type:    data.errorType ?? null,
          all_passed:    data.allPassed,
          passed_count:  data.testResults.filter((r) => r.passed).length,
          total_count:   data.testResults.length,
        });
      }
    } catch {
      setRunResult({ errorType: "NetworkError", errorMessage: "Request failed.", allPassed: false, executionTimeMs: 0, testResults: [] });
      postEvent("run", { code_content: codeAtRun, code_length: codeAtRun.length, error_type: "NetworkError", all_passed: false, passed_count: 0, total_count: 0 });
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, isSubmitting, postEvent, problem.id]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (isRunning || isSubmitting) return;
    setIsSubmitting(true);
    setIsSubmitResult(true);
    setRunResult(null);

    let result: RunResponse | null = null;
    try {
      const res = await fetch("/api/run", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          problemId:        problem.id,
          code:             codeRef.current,
          includeEdgeCases: true,
        }),
      });
      const data = await res.json() as RunResponse & { error?: string };
      if (!res.ok) {
        result = { errorType: "RunError", errorMessage: data.error ?? "Execution failed.", allPassed: false, executionTimeMs: 0, testResults: [] };
      } else {
        result = data;
      }
      setRunResult(result);
    } catch {
      result = { errorType: "NetworkError", errorMessage: "Request failed.", allPassed: false, executionTimeMs: 0, testResults: [] };
      setRunResult(result);
    }

    const outcome = result?.allPassed ? "passed" : "failed";

    // Record submit event + patch session outcome in parallel
    await Promise.allSettled([
      postEvent("submit", {
        outcome,
        all_passed:   result?.allPassed ?? false,
        code_content: codeRef.current,
        code_length:  codeRef.current.length,
        test_results: result?.testResults.map((r) => ({
          passed:       r.passed,
          is_edge_case: r.isEdgeCase,
        })) ?? [],
      }),
      sessionId && fetch(`/api/sessions/${sessionId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ outcome }),
      }),
    ]);

    setIsSubmitting(false);

    // Brief pause to show results, then redirect to check-in
    setTimeout(() => {
      if (sessionId) router.push(`/session/${sessionId}/checkin`);
    }, 2500);
  }, [isRunning, isSubmitting, postEvent, problem.id, sessionId, router]);

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    if (!resetConfirm) { setResetConfirm(true); setTimeout(() => setResetConfirm(false), 3000); return; }
    setCode(problem.starterCode ?? "def solution():\n    pass");
    setResetConfirm(false);
    setRunResult(null);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex overflow-hidden">
      {/* ── Left column — Problem ──────────────────────────────────────────── */}
      <div className="w-[42%] shrink-0 flex flex-col border-r border-[var(--color-border)] overflow-y-auto">
        <div className="p-5 flex flex-col gap-4">
          {/* Header */}
          <div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {problem.conceptTags.map((t) => (
                <span key={t.slug} className="px-2 py-0.5 rounded-full text-xs font-medium text-[var(--color-primary)] bg-[rgba(167,139,250,0.1)]">
                  {t.label}
                </span>
              ))}
              <span className="px-2 py-0.5 rounded-full text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)]">
                {problem.difficultyTier}
              </span>
            </div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{problem.title}</h1>
          </div>

          {/* Description */}
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
            {problem.description}
          </p>

          {/* Test cases (collapsible) */}
          {problem.testCases.length > 0 && (
            <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
              <button
                onClick={() => setShowTestCases((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <span>Test cases ({problem.testCases.length})</span>
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  {showTestCases ? "expand_less" : "expand_more"}
                </span>
              </button>
              {showTestCases && (
                <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border-subtle)]">
                  {problem.testCases.map((tc, i) => (
                    <div key={tc.id} className="px-4 py-2.5 text-xs font-mono">
                      <span className="text-[var(--color-text-muted)]">Test {i + 1}{tc.description ? ` · ${tc.description}` : ""}</span>
                      <div className="mt-1 flex gap-3 text-[var(--color-text-secondary)]">
                        <span><span className="text-[var(--color-text-muted)]">in:</span> {tc.input}</span>
                        <span><span className="text-[var(--color-text-muted)]">→</span> {tc.expectedOutput}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right column — Editor ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e]">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRun}
              disabled={isRunning || isSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[#3A3A3A] disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>play_arrow</span>
              Run
            </button>
            <button
              onClick={handleSubmit}
              disabled={isRunning || isSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)] text-[#0C0C0C] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {isSubmitting ? (
                <><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />Submitting…</>
              ) : (
                <><span className="material-symbols-outlined" style={{ fontSize: "14px" }}>check</span>Submit</>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-muted)] font-mono">{formatTime(elapsedSec)}</span>
            <button
              onClick={handleReset}
              className={`text-xs px-2 py-1 rounded transition-colors ${resetConfirm ? "text-[#F87171] bg-[rgba(248,113,113,0.1)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"}`}
            >
              {resetConfirm ? "Confirm reset?" : "Reset"}
            </button>
          </div>
        </div>

        {/* Monaco Editor */}
        <div className="flex-1 overflow-hidden">
          <MonacoEditor
            height="100%"
            language="python"
            theme="vs-dark"
            value={code}
            onChange={(val) => setCode(val ?? "")}
            onMount={handleEditorMount as Parameters<typeof MonacoEditor>[0]["onMount"]}
            options={{
              minimap:                    { enabled: false },
              suggestOnTriggerCharacters: false,
              quickSuggestions:           false,
              wordBasedSuggestions:       "off" as const,
              parameterHints:             { enabled: false },
              fontSize:                   14,
              fontFamily:                 '"JetBrains Mono", monospace',
              fontLigatures:              true,
              lineNumbers:                "on",
              scrollBeyondLastLine:       false,
              padding:                    { top: 16, bottom: 16 },
              automaticLayout:            true,
              tabSize:                    4,
              insertSpaces:               true,
            }}
          />
        </div>

        {/* Output panel */}
        {(runResult || isRunning || isSubmitting) && (
          <div className="shrink-0 max-h-64 overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-surface)]">
            <OutputPanel result={runResult} isRunning={isRunning || isSubmitting} isSubmit={isSubmitResult} />
          </div>
        )}
      </div>
    </div>
  );
}
