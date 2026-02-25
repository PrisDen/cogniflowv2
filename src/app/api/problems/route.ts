import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const DIFFICULTY_ORDER = { beginner: 0, intermediate: 1, advanced: 2 } as const;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const problems = await prisma.problem.findMany({
    where: { isActive: true },
    include: {
      problemConceptTags: {
        include: { conceptTag: true },
      },
      sessions: {
        where:  { userId: session.user.id },
        select: { outcome: true },
      },
    },
  });

  // Sort: primary concept sort_order → secondary difficulty
  const sorted = [...problems].sort((a, b) => {
    const aOrder = Math.min(...a.problemConceptTags.map((t) => t.conceptTag.sortOrder));
    const bOrder = Math.min(...b.problemConceptTags.map((t) => t.conceptTag.sortOrder));
    if (aOrder !== bOrder) return aOrder - bOrder;
    return DIFFICULTY_ORDER[a.difficultyTier] - DIFFICULTY_ORDER[b.difficultyTier];
  });

  const result = sorted.map((p) => ({
    id:             p.id,
    title:          p.title,
    difficultyTier: p.difficultyTier,
    conceptTags:    p.problemConceptTags
      .sort((a, b) => a.conceptTag.sortOrder - b.conceptTag.sortOrder)
      .map((t) => ({ slug: t.conceptTag.slug, label: t.conceptTag.label, sortOrder: t.conceptTag.sortOrder })),
    status: p.sessions.some((s) => s.outcome === "passed")
      ? "passed"
      : p.sessions.length > 0
      ? "attempted"
      : "not_attempted",
  }));

  return NextResponse.json(result);
}
