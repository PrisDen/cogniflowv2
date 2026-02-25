"use client";

import { useState } from "react";
import Link from "next/link";
import type { GapStatus } from "@/lib/gaps";

// ── Concept icon map ───────────────────────────────────────────────────────

const CONCEPT_ICONS: Record<string, string> = {
  arrays:          "data_array",
  strings:         "text_fields",
  loops:           "loop",
  conditionals:    "account_tree",
  functions:       "functions",
  dictionaries:    "book_2",
  sorting:         "sort",
  "recursion-basic": "autorenew",
  "two-pointers":  "compare_arrows",
  "edge-cases":    "warning",
};

const STATUS_CONFIG: Record<GapStatus, {
  label:      string;
  cardBg:     string;
  cardBorder: string;
  badgeBg:    string;
  badgeText:  string;
  iconColor:  string;
  iconBg:     string;
}> = {
  gap: {
    label:      "Gap",
    cardBg:     "bg-[rgba(167,139,250,0.04)]",
    cardBorder: "border-[rgba(167,139,250,0.15)] hover:border-[var(--color-primary)]",
    badgeBg:    "bg-[rgba(167,139,250,0.1)]",
    badgeText:  "text-[var(--color-primary)]",
    iconColor:  "text-[var(--color-primary)]",
    iconBg:     "bg-[rgba(167,139,250,0.1)]",
  },
  developing: {
    label:      "Developing",
    cardBg:     "bg-[var(--color-surface)]",
    cardBorder: "border-[var(--color-border)] hover:border-[#3A3A3A]",
    badgeBg:    "bg-[var(--color-surface-elevated)]",
    badgeText:  "text-[var(--color-text-secondary)]",
    iconColor:  "text-[var(--color-text-secondary)]",
    iconBg:     "bg-[var(--color-surface-elevated)]",
  },
  strong: {
    label:      "Strong",
    cardBg:     "bg-[rgba(96,165,250,0.04)]",
    cardBorder: "border-[rgba(96,165,250,0.15)] hover:border-[#60A5FA]",
    badgeBg:    "bg-[rgba(96,165,250,0.1)]",
    badgeText:  "text-[#60A5FA]",
    iconColor:  "text-[#60A5FA]",
    iconBg:     "bg-[rgba(96,165,250,0.1)]",
  },
  not_yet: {
    label:      "Not yet",
    cardBg:     "bg-[var(--color-surface)] opacity-60",
    cardBorder: "border-[var(--color-border)] hover:border-[#3A3A3A]",
    badgeBg:    "bg-[var(--color-surface-elevated)]",
    badgeText:  "text-[var(--color-text-muted)]",
    iconColor:  "text-[var(--color-text-muted)]",
    iconBg:     "bg-[var(--color-surface-elevated)]",
  },
};

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConceptCardData {
  conceptTagId:      string;
  slug:              string;
  label:             string;
  sessionsAttempted: number;
  status:            GapStatus;
  trend:             string | null;
  avgErrorCount:     number | null;
  avgSessionMinutes: number | null;
}

export interface ImprovingConceptData {
  label: string;
  slug:  string;
  message: string;
}

export interface RestartWarning {
  message: string;
}

interface GapsClientProps {
  concepts:    ConceptCardData[];
  improving:   ImprovingConceptData[];
  hasRestart:  boolean;
  restartMsg:  string;
}

type FilterType = "all" | GapStatus;

// ── Component ─────────────────────────────────────────────────────────────

export function GapsClient({ concepts, improving, hasRestart, restartMsg }: GapsClientProps) {
  const [filter, setFilter] = useState<FilterType>("all");

  const visible = filter === "all"
    ? concepts
    : concepts.filter((c) => c.status === filter);

  const filters: { key: FilterType; label: string }[] = [
    { key: "all",        label: "All Concepts" },
    { key: "gap",        label: "Gap" },
    { key: "developing", label: "Developing" },
    { key: "strong",     label: "Strong" },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={[
              "px-4 py-2 rounded-full text-xs font-medium transition-colors border",
              filter === f.key
                ? "bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] border-[var(--color-border)]"
                : "bg-transparent border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[#3A3A3A]",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Concept grid */}
      {visible.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] text-center py-8">
          No concepts match this filter yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((c) => (
            <ConceptCard key={c.conceptTagId} data={c} />
          ))}
        </div>
      )}

      {/* Improving concepts */}
      {improving.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Improving</h2>
          {improving.map((item) => (
            <div
              key={item.slug}
              className="p-5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-start gap-4"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[rgba(74,222,128,0.1)] text-[#4ADE80] shrink-0">
                <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>trending_up</span>
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">{item.label}</span>
                  <span className="text-xs text-[#4ADE80] flex items-center gap-0.5">
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>north_east</span>
                    improving
                  </span>
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{item.message}</p>
              </div>
              <Link
                href={`/problems?concept=${item.slug}`}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Practice
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Persistent restart warning */}
      {hasRestart && (
        <div className="p-5 rounded-xl bg-[rgba(167,139,250,0.04)] border border-[rgba(167,139,250,0.15)] flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[rgba(167,139,250,0.1)] text-[var(--color-primary)] shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>restart_alt</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Pattern detected</span>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{restartMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ConceptCard ────────────────────────────────────────────────────────────

function ConceptCard({ data }: { data: ConceptCardData }) {
  const cfg  = STATUS_CONFIG[data.status];
  const icon = CONCEPT_ICONS[data.slug] ?? "category";

  return (
    <Link
      href={`/problems?concept=${data.slug}`}
      className={`group flex flex-col gap-4 rounded-xl border p-5 transition-all duration-200 ${cfg.cardBg} ${cfg.cardBorder}`}
    >
      <div className="flex items-start justify-between">
        <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${cfg.iconBg} ${cfg.iconColor}`}>
          <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>{icon}</span>
        </div>
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.badgeBg} ${cfg.badgeText}`}
          style={{ boxShadow: "none" }}>
          {cfg.label}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors">
          {data.label}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          {data.sessionsAttempted === 0
            ? "No sessions yet"
            : `${data.sessionsAttempted} session${data.sessionsAttempted !== 1 ? "s" : ""}`}
          {data.avgSessionMinutes !== null && data.sessionsAttempted > 0 && (
            <> · avg {Math.round(data.avgSessionMinutes)}m</>
          )}
        </p>
      </div>
    </Link>
  );
}
