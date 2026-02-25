import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deriveGapStatus, checkPersistentRestart, buildImprovementMessage, buildRestartPatternMessage } from "@/lib/gaps";
import { GapsClient } from "@/components/gaps/GapsClient";
import type { ConceptCardData, ImprovingConceptData } from "@/components/gaps/GapsClient";

export default async function GapsPage() {
  const session = await auth();
  const userId  = session!.user.id;

  const [allTags, gapRows, hasRestart] = await Promise.all([
    prisma.conceptTag.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.userConceptGap.findMany({
      where:   { userId },
      include: { conceptTag: { select: { slug: true, label: true } } },
    }),
    checkPersistentRestart(userId, prisma),
  ]);

  // Build a lookup for faster access
  const gapByTagId = new Map(gapRows.map((r) => [r.conceptTagId, r]));

  // Merge concept tags with gap data — all tags appear, even untouched ones
  const concepts: ConceptCardData[] = allTags.map((tag) => {
    const row = gapByTagId.get(tag.id);
    return {
      conceptTagId:      tag.id,
      slug:              tag.slug,
      label:             tag.label,
      sessionsAttempted: row?.sessionsAttempted ?? 0,
      status:            row ? deriveGapStatus(row) : "not_yet",
      trend:             row?.trend ?? null,
      avgErrorCount:     row?.avgErrorCount ?? null,
      avgSessionMinutes: row?.avgSessionMinutes ?? null,
    };
  });

  // Improving concepts (trend=improving, ≥4 sessions)
  const improving: ImprovingConceptData[] = gapRows
    .filter((r) => r.trend === "improving" && r.sessionsAttempted >= 4)
    .map((r) => ({
      label:   r.conceptTag.label,
      slug:    r.conceptTag.slug,
      message: buildImprovementMessage(r.conceptTag.label),
    }));

  const totalSessions = await prisma.session.count({ where: { userId } });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold text-[var(--color-text-primary)] tracking-tight">Your gaps</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Track your conceptual understanding and identify areas for focus.
        </p>
      </div>

      {totalSessions < 3 ? (
        /* Not enough data yet */
        <div className="p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            Gap tracking activates after your first 3 sessions. Each session adds more signal — the tracker gets more accurate over time.
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">
            {totalSessions} of 3 sessions completed.
          </p>
        </div>
      ) : (
        <GapsClient
          concepts={concepts}
          improving={improving}
          hasRestart={hasRestart}
          restartMsg={buildRestartPatternMessage()}
        />
      )}
    </div>
  );
}
