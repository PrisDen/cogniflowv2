import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProblemWorkspace } from "@/components/editor/ProblemWorkspace";
import type { ProblemDetail } from "@/types/problem";

// Full-height workspace — don't use the (app) layout's padding
export const dynamic = "force-dynamic";

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const problem = await prisma.problem.findUnique({
    where: { id, isActive: true },
    include: {
      problemConceptTags: { include: { conceptTag: true } },
      testCases: {
        where:   { isEdgeCase: false },
        orderBy: { orderIndex: "asc" },
        take:    3,
      },
    },
  });

  if (!problem) notFound();

  const detail: ProblemDetail = {
    id:                 problem.id,
    title:              problem.title,
    description:        problem.description,
    starterCode:        problem.starterCode,
    difficultyTier:     problem.difficultyTier,
    expectedComplexity: problem.expectedComplexity,
    conceptTags: problem.problemConceptTags
      .sort((a, b) => a.conceptTag.sortOrder - b.conceptTag.sortOrder)
      .map((t) => ({ slug: t.conceptTag.slug, label: t.conceptTag.label, sortOrder: t.conceptTag.sortOrder })),
    testCases: problem.testCases.map((tc) => ({
      id:             tc.id,
      input:          tc.input,
      expectedOutput: tc.expectedOutput,
      orderIndex:     tc.orderIndex,
      description:    tc.description,
    })),
  };

  return <ProblemWorkspace problem={detail} />;
}
