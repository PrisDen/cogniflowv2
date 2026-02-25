"use client";

import { useState } from "react";
import { ProblemCard } from "./ProblemCard";
import type { ProblemListItem, ConceptTag } from "@/types/problem";

interface ProblemsClientProps {
  problems:    ProblemListItem[];
  conceptTags: ConceptTag[];
}

export function ProblemsClient({ problems, conceptTags }: ProblemsClientProps) {
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const visible = activeFilter === "all"
    ? problems
    : problems.filter((p) => p.conceptTags.some((t) => t.slug === activeFilter));

  return (
    <div className="flex flex-col gap-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        <FilterTab
          label="All"
          isActive={activeFilter === "all"}
          onClick={() => setActiveFilter("all")}
          count={problems.length}
        />
        {conceptTags.map((tag) => {
          const count = problems.filter((p) => p.conceptTags.some((t) => t.slug === tag.slug)).length;
          if (count === 0) return null;
          return (
            <FilterTab
              key={tag.slug}
              label={tag.label}
              isActive={activeFilter === tag.slug}
              onClick={() => setActiveFilter(tag.slug)}
              count={count}
            />
          );
        })}
      </div>

      {/* Problem list */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
            No problems match this filter.
          </p>
        ) : (
          visible.map((p) => <ProblemCard key={p.id} problem={p} />)
        )}
      </div>
    </div>
  );
}

function FilterTab({
  label, isActive, onClick, count,
}: {
  label: string; isActive: boolean; onClick: () => void; count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
        isActive
          ? "bg-[rgba(167,139,250,0.12)] text-[var(--color-primary)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-elevated)]",
      ].join(" ")}
    >
      {label}
      <span
        className={[
          "text-xs px-1.5 py-0.5 rounded-full font-medium",
          isActive
            ? "bg-[rgba(167,139,250,0.2)] text-[var(--color-primary)]"
            : "bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]",
        ].join(" ")}
      >
        {count}
      </span>
    </button>
  );
}
