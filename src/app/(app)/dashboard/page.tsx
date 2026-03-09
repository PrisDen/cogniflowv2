import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deriveGapStatus } from "@/lib/gaps";
import {
  buildBehaviorHistory,
  summarizeBehaviorPatterns,
  type BehaviorPatternSummary,
  type TrendDirection,
  type SessionHistoryInput,
  type SessionBehaviorSummary,
} from "@/lib/behaviorMetrics";
import type { Insight } from "@/lib/insights";
import { formatDistanceToNowStrict, format } from "date-fns";

// ── Helpers ────────────────────────────────────────────────────────────────

function firstName(emailOrName: string): string {
  const name = emailOrName.split("@")[0].replace(/[._-]/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const OUTCOME_CONFIG = {
  passed:    { label: "Passed",   color: "text-[#4ADE80] bg-[rgba(74,222,128,0.08)] border-[rgba(74,222,128,0.15)]" },
  failed:    { label: "Failed",   color: "text-[#F87171] bg-[rgba(248,113,113,0.08)] border-[rgba(248,113,113,0.15)]" },
  abandoned: { label: "Attempted", color: "text-[var(--color-text-muted)] bg-[var(--color-surface-elevated)] border-[var(--color-border)]" },
} as const;

// ── Page ──────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await auth();
  const userId  = session!.user.id;

  const [user, allSessions, gapRows, behaviorSessionRows, recentSessions] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, email: true },
    }),
    // All sessions for stats
    prisma.session.findMany({
      where:  { userId },
      select: { id: true, outcome: true, problemId: true },
    }),
    // Gap data sorted by worst gap first
    prisma.userConceptGap.findMany({
      where:   { userId },
      include: { conceptTag: { select: { slug: true, label: true } } },
      orderBy: { avgErrorCount: "desc" },
    }),
    // Last 10 completed sessions for behavior metrics — only run/submit events needed
    prisma.session.findMany({
      where:   { userId, checkinCompletedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      take:    10,
      select:  {
        id:        true,
        startedAt: true,
        events: {
          where:  { type: { in: ["run", "submit"] } },
          select: { type: true, occurredAt: true, metadata: true },
        },
        insights: { select: { observation: true } },
      },
    }),
    // Last 5 sessions for the session history cards
    prisma.session.findMany({
      where:   { userId, checkinCompletedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      take:    5,
      include: {
        problem: {
          include: {
            problemConceptTags: {
              include: { conceptTag: { select: { slug: true, label: true } } },
            },
          },
        },
        insights: { orderBy: { priority: "asc" }, take: 1 },
      },
    }),
  ]);

  // Stats
  const totalSessions    = allSessions.length;
  const passedProblemIds = new Set(allSessions.filter((s) => s.outcome === "passed").map((s) => s.problemId));
  const passedCount      = passedProblemIds.size;

  // Top gap — must have ≥ 3 sessions and gap status
  const topGap = gapRows.find((r) => deriveGapStatus(r) === "gap" && r.sessionsAttempted >= 3) ?? null;

  // Suggested problem for top gap (first unsolvedproblem tagged with top gap concept)
  const suggestedProblem = topGap
    ? await prisma.problem.findFirst({
        where: {
          isActive: true,
          problemConceptTags: { some: { conceptTag: { slug: topGap.conceptTag.slug } } },
          sessions:           { none: { userId, outcome: "passed" } },
        },
        select: { id: true, title: true },
      })
    : null;

  // Quick gap summary (top 4 concepts user has touched)
  const quickGaps = gapRows.slice(0, 4).map((r) => ({
    label:  r.conceptTag.label,
    slug:   r.conceptTag.slug,
    status: deriveGapStatus(r),
  }));

  // Behavior trends — compute from last 10 completed sessions
  const historyInputs: SessionHistoryInput[] = behaviorSessionRows.map((s) => ({
    id:        s.id,
    startedAt: s.startedAt,
    events:    s.events.map((e) => ({
      type:       e.type as string,
      occurredAt: e.occurredAt,
      metadata:   e.metadata as Record<string, unknown>,
    })),
    // message is required by Insight type but unused by behavior metrics
    insights: s.insights.map((i) => ({ observation: i.observation, message: "" }) as Insight),
  }));

  const behaviorHistory  = buildBehaviorHistory(historyInputs);
  const patternSummary   = behaviorHistory.length >= 2
    ? summarizeBehaviorPatterns(behaviorHistory)
    : null;

  const displayName = user?.displayName ?? firstName(user?.email ?? "there");
  const hasHistory  = totalSessions >= 3;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">

      {/* ── Welcome ────────────────────────────────────────────────────────── */}
      <section>
        <h1 className="text-3xl font-semibold text-[var(--color-text-primary)] tracking-tight">
          Welcome back, {displayName}.
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {totalSessions === 0
            ? "No sessions yet."
            : `${totalSessions} session${totalSessions !== 1 ? "s" : ""} · ${passedCount} problem${passedCount !== 1 ? "s" : ""} passed`}
        </p>
      </section>

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {totalSessions === 0 && (
        <section className="p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col gap-3">
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            You haven&apos;t solved any problems yet. Start with your first one — the insights get better the more sessions you have.
          </p>
          <Link
            href="/problems"
            className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--color-primary)] text-[#0C0C0C] hover:bg-[var(--color-primary-hover)] transition-colors"
          >
            Browse Problems
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>arrow_forward</span>
          </Link>
        </section>
      )}

      {/* ── Top gap banner ──────────────────────────────────────────────────── */}
      {topGap && (
        <section className="p-5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[rgba(251,191,36,0.1)] text-[#FBBF24] shrink-0">
              <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>target</span>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-0.5">Top concept gap</p>
              <p className="text-base font-semibold text-[var(--color-text-primary)]">
                {topGap.conceptTag.label}
                <span className="ml-2 text-xs font-normal text-[#F87171]">(gap)</span>
              </p>
            </div>
          </div>

          {suggestedProblem && (
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--color-border)]">
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mb-0.5">Suggested next problem</p>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">{suggestedProblem.title}</p>
              </div>
              <Link
                href={`/problems/${suggestedProblem.id}`}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[rgba(167,139,250,0.3)] text-[var(--color-primary)] hover:bg-[rgba(167,139,250,0.08)] transition-colors text-sm font-medium"
              >
                Start
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>arrow_forward</span>
              </Link>
            </div>
          )}

          {!suggestedProblem && (
            <Link
              href={`/problems?concept=${topGap.conceptTag.slug}`}
              className="self-start inline-flex items-center gap-2 text-sm font-medium text-[var(--color-primary)] hover:underline"
            >
              See {topGap.conceptTag.label} problems
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>arrow_forward</span>
            </Link>
          )}
        </section>
      )}

      {/* ── Behavior trends ─────────────────────────────────────────────────── */}
      {hasHistory
        ? patternSummary && <BehaviorTrendsCard summary={patternSummary} />
        : totalSessions > 0 && <BehaviorTrendsEmpty />
      }

      {/* ── Quick gap summary ──────────────────────────────────────────────── */}
      {hasHistory && quickGaps.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Concept overview</h2>
            <Link href="/gaps" className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
              Full gap tracker →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quickGaps.map((g) => (
              <ConceptChip key={g.slug} label={g.label} status={g.status} />
            ))}
          </div>
        </section>
      )}

      {/* ── Session behavior history ────────────────────────────────────────── */}
      <BehaviorTimeline sessions={behaviorHistory} />

      {/* ── Recent sessions ─────────────────────────────────────────────────── */}
      {recentSessions.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--color-primary)]" style={{ fontSize: "18px" }}>history</span>
              Recent sessions
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentSessions.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        </section>
      )}

      {/* ── Browse CTA (always shown if user has history) ──────────────────── */}
      {totalSessions > 0 && (
        <section>
          <Link
            href="/problems"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[#3A3A3A] transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>apps</span>
            Browse all problems
          </Link>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

// ── BehaviorTrendsCard ────────────────────────────────────────────────────

const TREND_ROWS: Array<{ key: keyof BehaviorPatternSummary; label: string }> = [
  { key: "syntaxErrors",     label: "Syntax errors" },
  { key: "runFrequency",     label: "Run frequency" },
  { key: "restartBehavior",  label: "Restart behavior" },
  { key: "edgeCaseHandling", label: "Edge-case handling" },
];

const TREND_STYLES: Record<TrendDirection, { label: string; color: string; icon: string }> = {
  improving: { label: "improving", color: "text-[#4ADE80]",                    icon: "trending_up" },
  stable:    { label: "stable",    color: "text-[var(--color-text-muted)]",    icon: "trending_flat" },
  worsening: { label: "worsening", color: "text-[#F87171]",                    icon: "trending_down" },
};

function BehaviorTrendsCard({ summary }: { summary: BehaviorPatternSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <span className="material-symbols-outlined text-[var(--color-primary)]" style={{ fontSize: "18px" }}>
            insights
          </span>
          Recent behavior
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {TREND_ROWS.map(({ key, label }) => {
          const direction = summary[key];
          const cfg       = TREND_STYLES[direction];
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]"
            >
              <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
              <span className={`flex items-center gap-1 text-xs font-semibold ${cfg.color}`}>
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                  {cfg.icon}
                </span>
                {cfg.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BehaviorTrendsEmpty() {
  return (
    <section className="px-4 py-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <p className="text-sm text-[var(--color-text-muted)]">
        Cogniflow learns your patterns after a few sessions.
      </p>
    </section>
  );
}

// ── BehaviorTimeline ──────────────────────────────────────────────────────

function BehaviorTimeline({ sessions }: { sessions: SessionBehaviorSummary[] }) {
  if (sessions.length < 2) {
    return (
      <section className="px-4 py-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <p className="text-sm text-[var(--color-text-muted)]">
          Session history will appear after you complete more problems.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
        <span
          className="material-symbols-outlined text-[var(--color-primary)]"
          style={{ fontSize: "18px" }}
        >
          calendar_month
        </span>
        Session behavior history
      </h2>

      <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        {sessions.map((s, index) => (
          <SessionBehaviorRow key={s.sessionId} session={s} index={index} />
        ))}
      </div>
    </section>
  );
}

// ── SessionBehaviorRow ────────────────────────────────────────────────────

interface MetricCell {
  icon:       string;
  label:      string;
  value:      string;
  /** Tailwind text-color class applied when the signal is "notable" */
  alertColor: string;
  isAlert:    boolean;
}

function SessionBehaviorRow({
  session: s,
  index,
}: {
  session: SessionBehaviorSummary;
  index:   number;
}) {
  const dateLabel = format(new Date(s.startedAt), "MMM d");

  const metrics: MetricCell[] = [
    {
      icon:       "code",
      label:      "Syntax errors",
      value:      String(s.syntaxErrors),
      alertColor: "text-[#FB923C]",
      isAlert:    s.syntaxErrors > 0,
    },
    {
      icon:       "play_circle",
      label:      "Runs",
      value:      String(s.runCount),
      alertColor: "text-[var(--color-text-primary)]",
      isAlert:    false,
    },
    {
      icon:       "psychology",
      label:      "Logic failures",
      value:      String(s.logicFailures),
      alertColor: "text-[#FB923C]",
      isAlert:    s.logicFailures > 0,
    },
    {
      icon:       "refresh",
      label:      "Restart",
      value:      s.restartDetected ? "yes" : "no",
      alertColor: "text-[#FBBF24]",
      isAlert:    s.restartDetected,
    },
    {
      icon:       "warning",
      label:      "Edge-case fail",
      value:      s.edgeCaseFailure ? "yes" : "no",
      alertColor: "text-[#F87171]",
      isAlert:    s.edgeCaseFailure,
    },
  ];

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] transition-colors">
      {/* Date + session index */}
      <div className="flex items-center gap-2 sm:w-28 shrink-0">
        <span className="text-[10px] font-medium text-[var(--color-text-muted)] tabular-nums w-5 text-right">
          {index + 1}
        </span>
        <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{dateLabel}</span>
      </div>

      {/* Metric chips */}
      <div className="flex flex-wrap gap-2">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
          >
            <span
              className={`material-symbols-outlined ${m.isAlert ? m.alertColor : "text-[var(--color-text-muted)]"}`}
              style={{ fontSize: "12px", fontVariationSettings: "'FILL' 1" }}
            >
              {m.icon}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] hidden sm:inline">
              {m.label}
            </span>
            <span
              className={`text-xs font-semibold tabular-nums ${
                m.isAlert ? m.alertColor : "text-[var(--color-text-secondary)]"
              }`}
            >
              {m.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_CHIP_CONFIG = {
  gap:        { label: "Gap",        color: "text-[var(--color-primary)] bg-[rgba(167,139,250,0.08)] border-[rgba(167,139,250,0.15)]" },
  developing: { label: "Developing", color: "text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] border-[var(--color-border)]" },
  strong:     { label: "Strong",     color: "text-[#60A5FA] bg-[rgba(96,165,250,0.08)] border-[rgba(96,165,250,0.15)]" },
  not_yet:    { label: "Not yet",    color: "text-[var(--color-text-muted)] bg-[var(--color-surface)] border-[var(--color-border)]" },
};

function ConceptChip({ label, status }: { label: string; status: string }) {
  const cfg = STATUS_CHIP_CONFIG[status as keyof typeof STATUS_CHIP_CONFIG] ?? STATUS_CHIP_CONFIG.not_yet;
  return (
    <div className={`flex flex-col gap-1 px-3 py-2.5 rounded-lg border ${cfg.color}`}>
      <span className="text-xs font-medium truncate">{label}</span>
      <span className="text-[10px] opacity-70">{cfg.label}</span>
    </div>
  );
}

type SessionRow = Awaited<ReturnType<typeof prisma.session.findMany<{
  include: {
    problem: { include: { problemConceptTags: { include: { conceptTag: { select: { slug: true; label: true } } } } } };
    insights: true;
  };
}>>>[0];

function SessionCard({ session: s }: { session: SessionRow }) {
  const outcome = s.outcome ? (OUTCOME_CONFIG[s.outcome] ?? null) : null;
  const insight = s.insights[0];
  const tags    = s.problem.problemConceptTags
    .slice(0, 2)
    .map((t) => t.conceptTag.label);

  return (
    <Link
      href={`/session/${s.id}/reflection`}
      className="group flex flex-col p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[#3A3A3A] transition-colors h-full"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs text-[var(--color-text-muted)]">
          {formatDistanceToNowStrict(new Date(s.startedAt), { addSuffix: true })}
        </span>
        {outcome && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${outcome.color}`}>
            {outcome.label}
          </span>
        )}
      </div>

      <p className="text-sm font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors mb-1.5">
        {s.problem.title}
      </p>

      <div className="flex flex-wrap gap-1 mb-3">
        {tags.map((t) => (
          <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-medium text-[var(--color-primary)] bg-[rgba(167,139,250,0.1)]">
            {t}
          </span>
        ))}
      </div>

      {insight && (
        <>
          <div className="h-px w-full bg-[var(--color-border-subtle)] mb-3" />
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed line-clamp-3 flex-grow">
            {insight.message}
          </p>
        </>
      )}
    </Link>
  );
}
