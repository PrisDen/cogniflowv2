import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// ── Observation display metadata ──────────────────────────────────────────

const OBSERVATION_LABELS: Record<string, { label: string; icon: string }> = {
  syntax_heavy:       { label: "Syntax fluency gap",       icon: "code" },
  logic_heavy:        { label: "Logic gap",                icon: "psychology" },
  edge_case_blindness:{ label: "Edge case blindness",      icon: "warning" },
  repeated_error:     { label: "Repeated error",           icon: "error" },
  stuck_loop:         { label: "Stuck loop",               icon: "loop" },
  long_stuck:         { label: "Stuck on one error",       icon: "hourglass_bottom" },
  restart:            { label: "Restart detected",         icon: "restart_alt" },
  paste_detected:     { label: "Paste detected",           icon: "content_paste" },
  no_planning:        { label: "No upfront planning",      icon: "edit_note" },
  infrequent_running: { label: "Infrequent running",       icon: "play_circle" },
  reading_time:       { label: "Short reading time",       icon: "menu_book" },
  planning_detected:  { label: "Planned before coding",    icon: "task_alt" },
  print_debugging:    { label: "Print-based debugging",    icon: "terminal" },
};

// ── Page ──────────────────────────────────────────────────────────────────

export default async function ReflectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = await params;
  const session  = await auth();

  const record = await prisma.session.findFirst({
    where: { id, userId: session!.user.id },
    include: {
      problem:  { select: { id: true, title: true } },
      insights: { orderBy: { priority: "asc" } },
      events:   { select: { type: true }, where: { type: "run" } },
    },
  });

  if (!record) notFound();

  const durationMin = record.endedAt
    ? Math.round((record.endedAt.getTime() - record.startedAt.getTime()) / 60_000)
    : null;

  const critical = record.insights.find((i) => i.priority === 1);
  const positive = record.insights.find((i) => i.priority === 2);
  const hasInsights = critical || positive;

  return (
    <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <OutcomeBadge outcome={record.outcome ?? null} />
        </div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
          {record.problem.title}
        </h1>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
          {durationMin !== null && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>timer</span>
              {durationMin} min
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>play_circle</span>
            {record.events.length} run{record.events.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Insights ─────────────────────────────────────────────────────── */}
      {hasInsights ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            Your reflection
          </p>

          {critical && (
            <InsightCard insight={critical} isCritical />
          )}
          {positive && (
            <InsightCard insight={positive} isCritical={false} />
          )}
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Not enough session data to generate an insight yet. Your next attempt will have more to go on.
          </p>
        </div>
      )}

      {/* ── Check-in echo ─────────────────────────────────────────────────── */}
      {(record.checkinFeel === 1 || record.checkinConfidence === 1 || record.checkinConfidence === 4) && (
        <CheckinEcho feel={record.checkinFeel} confidence={record.checkinConfidence} />
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pt-2">
        <Link
          href="/problems"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold bg-[var(--color-primary)] text-[#0C0C0C] hover:bg-[var(--color-primary-hover)] transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>apps</span>
          Keep practicing
        </Link>
        <Link
          href={`/problems/${record.problem.id}`}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[#3A3A3A] transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>replay</span>
          Try this problem again
        </Link>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  const config = {
    passed:    { label: "Passed",   color: "text-[#4ADE80] bg-[rgba(74,222,128,0.08)] border-[rgba(74,222,128,0.15)]",  icon: "check_circle" },
    failed:    { label: "Failed",   color: "text-[#F87171] bg-[rgba(248,113,113,0.08)] border-[rgba(248,113,113,0.15)]", icon: "cancel" },
    abandoned: { label: "Abandoned",color: "text-[var(--color-text-muted)] bg-[var(--color-surface-elevated)] border-[var(--color-border)]", icon: "do_not_disturb_on" },
  }[outcome] ?? null;

  if (!config) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.color}`}>
      <span className="material-symbols-outlined" style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}>
        {config.icon}
      </span>
      {config.label}
    </span>
  );
}

function InsightCard({
  insight,
  isCritical,
}: {
  insight: { observation: string; message: string };
  isCritical: boolean;
}) {
  const meta = OBSERVATION_LABELS[insight.observation] ?? { label: insight.observation, icon: "info" };

  return (
    <div className={[
      "p-4 rounded-xl border flex flex-col gap-3",
      isCritical
        ? "border-[rgba(167,139,250,0.2)] bg-[rgba(167,139,250,0.04)]"
        : "border-[rgba(74,222,128,0.15)] bg-[rgba(74,222,128,0.04)]",
    ].join(" ")}>
      <div className="flex items-center gap-2">
        <span
          className={`material-symbols-outlined text-sm ${isCritical ? "text-[var(--color-primary)]" : "text-[#4ADE80]"}`}
          style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}
        >
          {meta.icon}
        </span>
        <span className={`text-xs font-semibold uppercase tracking-wide ${isCritical ? "text-[var(--color-primary)]" : "text-[#4ADE80]"}`}>
          {meta.label}
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
        {insight.message}
      </p>
    </div>
  );
}

function CheckinEcho({ feel, confidence }: { feel: number | null; confidence: number | null }) {
  const messages: string[] = [];

  if (feel === 1) {
    messages.push("You marked this session as completely lost. That's useful to know — but it raises a question: was it the problem itself, a concept you haven't seen, or Python syntax getting in the way? Those need different fixes. The session data might narrow it down.");
  }
  if (confidence === 1) {
    messages.push("You're not confident about this problem yet. Acknowledging that is the right thing to do — it means this problem isn't finished. Come back to it after practicing the gap it revealed.");
  }
  if (confidence === 4) {
    messages.push("You feel confident about this one. Worth checking: can you solve a variation of it from scratch without looking at what you wrote?");
  }

  if (messages.length === 0) return null;

  return (
    <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Your check-in</span>
      {messages.map((m, i) => (
        <p key={i} className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{m}</p>
      ))}
    </div>
  );
}
