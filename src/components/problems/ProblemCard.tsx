import Link from "next/link";
import type { ProblemListItem, DifficultyTier, AttemptStatus } from "@/types/problem";

const DIFFICULTY_LABEL: Record<DifficultyTier, string>  = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const DIFFICULTY_COLOR: Record<DifficultyTier, string>  = {
  beginner:     "text-[#4ADE80] bg-[rgba(74,222,128,0.08)]",
  intermediate: "text-[#FBBF24] bg-[rgba(251,191,36,0.08)]",
  advanced:     "text-[#F87171] bg-[rgba(248,113,113,0.08)]",
};

const STATUS_CONFIG: Record<AttemptStatus, { label: string; icon: string; color: string }> = {
  passed:        { label: "Passed",      icon: "check_circle", color: "text-[#4ADE80]" },
  attempted:     { label: "Attempted",   icon: "pending",      color: "text-[#FBBF24]" },
  not_attempted: { label: "Not started", icon: "radio_button_unchecked", color: "text-[var(--color-text-muted)]" },
};

interface ProblemCardProps {
  problem: ProblemListItem;
}

export function ProblemCard({ problem }: ProblemCardProps) {
  const statusCfg = STATUS_CONFIG[problem.status];

  return (
    <Link
      href={`/problems/${problem.id}`}
      className="group block bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:border-[#3A3A3A] hover:bg-[var(--color-surface-elevated)] transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        {/* Title + tags */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors truncate">
            {problem.title}
          </p>

          <div className="flex flex-wrap gap-1.5 mt-2">
            {problem.conceptTags.map((tag) => (
              <span
                key={tag.slug}
                className="px-2 py-0.5 rounded-full text-xs font-medium text-[var(--color-primary)] bg-[rgba(167,139,250,0.1)]"
              >
                {tag.label}
              </span>
            ))}
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${DIFFICULTY_COLOR[problem.difficultyTier]}`}
            >
              {DIFFICULTY_LABEL[problem.difficultyTier]}
            </span>
          </div>
        </div>

        {/* Status */}
        <div className={`flex items-center gap-1 shrink-0 ${statusCfg.color}`}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}>
            {statusCfg.icon}
          </span>
          <span className="text-xs font-medium hidden sm:inline">{statusCfg.label}</span>
        </div>
      </div>
    </Link>
  );
}
