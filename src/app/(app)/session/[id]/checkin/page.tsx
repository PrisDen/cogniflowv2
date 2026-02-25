"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────

type Feel       = 1 | 2 | 3 | 4;   // 1=lost, 2=struggled, 3=okay, 4=flowed
type PreWork    = "paper" | "mind" | "none";
type Confidence = 1 | 2 | 3 | 4;   // 1=not_at_all, 2=a_little, 3=mostly, 4=solid

interface CheckinState {
  feel:        Feel | null;
  preWork:     PreWork | null;
  interrupted: boolean | null;
  confidence:  Confidence | null;
}

// ── Option helpers ─────────────────────────────────────────────────────────

const FEEL_OPTIONS = [
  { value: 1 as Feel, label: "Completely lost" },
  { value: 2 as Feel, label: "Struggled" },
  { value: 3 as Feel, label: "Okay" },
  { value: 4 as Feel, label: "Flowed" },
];

const PREWORK_OPTIONS = [
  { value: "paper" as PreWork, label: "Yes, on paper" },
  { value: "mind"  as PreWork, label: "Yes, in my head" },
  { value: "none"  as PreWork, label: "No — figured it out as I coded" },
];

const CONFIDENCE_OPTIONS = [
  { value: 1 as Confidence, label: "Not at all" },
  { value: 2 as Confidence, label: "A little" },
  { value: 3 as Confidence, label: "Mostly" },
  { value: 4 as Confidence, label: "Solid" },
];

// ── Sub-components ─────────────────────────────────────────────────────────

function ScaleOption<T extends number | string>({
  value, label, selected, onClick,
}: {
  value: T; label: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-4 py-2.5 rounded-lg text-sm font-medium text-left transition-all border",
        selected
          ? "bg-[rgba(167,139,250,0.12)] border-[var(--color-primary)] text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[#3A3A3A] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function YesNoOption({
  value, selected, onClick,
}: {
  value: boolean; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-6 py-2.5 rounded-lg text-sm font-medium transition-all border",
        selected
          ? "bg-[rgba(167,139,250,0.12)] border-[var(--color-primary)] text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[#3A3A3A] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
    >
      {value ? "Yes" : "No"}
    </button>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CheckinPage() {
  const router   = useRouter();
  const { id }   = useParams<{ id: string }>();

  const [state, setState] = useState<CheckinState>({
    feel: null, preWork: null, interrupted: null, confidence: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allAnswered = state.feel !== null && state.preWork !== null &&
    state.interrupted !== null && state.confidence !== null;

  const handleSubmit = async () => {
    if (!allAnswered || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await fetch(`/api/sessions/${id}/checkin`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          feel:        state.feel,
          preWork:     state.preWork,
          interrupted: state.interrupted,
          confidence:  state.confidence,
        }),
      });
      router.push(`/session/${id}/reflection`);
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-8">
      {/* Header */}
      <div>
        <p className="text-xs font-medium text-[var(--color-primary)] uppercase tracking-wider mb-2">
          Before we look at your session
        </p>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
          A few quick questions
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Your answers help us calibrate the reflection. Takes under 30 seconds.
        </p>
      </div>

      {/* Q1 — Feel */}
      <Question label="How did this session feel?">
        <div className="grid grid-cols-2 gap-2">
          {FEEL_OPTIONS.map((o) => (
            <ScaleOption
              key={o.value}
              value={o.value}
              label={o.label}
              selected={state.feel === o.value}
              onClick={() => setState((s) => ({ ...s, feel: o.value }))}
            />
          ))}
        </div>
      </Question>

      {/* Q2 — Pre-work */}
      <Question label="Did you work any of this out before typing?">
        <div className="flex flex-col gap-2">
          {PREWORK_OPTIONS.map((o) => (
            <ScaleOption
              key={o.value}
              value={o.value}
              label={o.label}
              selected={state.preWork === o.value}
              onClick={() => setState((s) => ({ ...s, preWork: o.value }))}
            />
          ))}
        </div>
      </Question>

      {/* Q3 — Interrupted */}
      <Question label="Were you interrupted or distracted?">
        <div className="flex gap-3">
          <YesNoOption value={true}  selected={state.interrupted === true}  onClick={() => setState((s) => ({ ...s, interrupted: true }))} />
          <YesNoOption value={false} selected={state.interrupted === false} onClick={() => setState((s) => ({ ...s, interrupted: false }))} />
        </div>
      </Question>

      {/* Q4 — Confidence */}
      <Question label="How confident do you feel about this problem now?">
        <div className="grid grid-cols-2 gap-2">
          {CONFIDENCE_OPTIONS.map((o) => (
            <ScaleOption
              key={o.value}
              value={o.value}
              label={o.label}
              selected={state.confidence === o.value}
              onClick={() => setState((s) => ({ ...s, confidence: o.value }))}
            />
          ))}
        </div>
      </Question>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!allAnswered || isSubmitting}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold bg-[var(--color-primary)] text-[#0C0C0C] hover:bg-[var(--color-primary-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
      >
        {isSubmitting ? (
          <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Generating reflection…</>
        ) : (
          <><span className="material-symbols-outlined" style={{ fontSize: "16px" }}>arrow_forward</span>See reflection</>
        )}
      </button>
    </div>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
      {children}
    </div>
  );
}
