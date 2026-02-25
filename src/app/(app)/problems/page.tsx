import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ProblemsClient } from "@/components/problems/ProblemsClient";
import type { ProblemListItem, ConceptTag } from "@/types/problem";

const DIFFICULTY_ORDER = { beginner: 0, intermediate: 1, advanced: 2 } as const;

export default async function ProblemsPage() {
  const session = await auth();
  const userId  = session!.user.id;

  const [problemsRaw, tagsRaw] = await Promise.all([
    prisma.problem.findMany({
      where: { isActive: true },
      include: {
        problemConceptTags: { include: { conceptTag: true } },
        sessions: { where: { userId }, select: { outcome: true } },
      },
    }),
    prisma.conceptTag.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  // Sort: primary concept sort_order → secondary difficulty
  const sorted = [...problemsRaw].sort((a, b) => {
    const aOrder = Math.min(...a.problemConceptTags.map((t) => t.conceptTag.sortOrder));
    const bOrder = Math.min(...b.problemConceptTags.map((t) => t.conceptTag.sortOrder));
    if (aOrder !== bOrder) return aOrder - bOrder;
    return DIFFICULTY_ORDER[a.difficultyTier] - DIFFICULTY_ORDER[b.difficultyTier];
  });

  const problems: ProblemListItem[] = sorted.map((p) => ({
    id:             p.id,
    title:          p.title,
    difficultyTier: p.difficultyTier,
    conceptTags:    p.problemConceptTags
      .sort((a, b) => a.conceptTag.sortOrder - b.conceptTag.sortOrder)
      .map((t) => ({ slug: t.conceptTag.slug, label: t.conceptTag.label, sortOrder: t.conceptTag.sortOrder })),
    status: p.sessions.some((s) => s.outcome === "passed")
      ? "passed"
      : p.sessions.length > 0 ? "attempted" : "not_attempted",
  }));

  const conceptTags: ConceptTag[] = tagsRaw.map((t) => ({
    slug: t.slug, label: t.label, sortOrder: t.sortOrder,
  }));

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Problems</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {problems.length} problems · pick one and start coding
        </p>
      </div>
      <ProblemsClient problems={problems} conceptTags={conceptTags} />
    </div>
  );
}
