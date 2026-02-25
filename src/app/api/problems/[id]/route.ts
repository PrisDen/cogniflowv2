import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const problem = await prisma.problem.findUnique({
    where: { id, isActive: true },
    include: {
      problemConceptTags: { include: { conceptTag: true } },
      // Only non-edge cases shown in the problem description
      testCases: {
        where:   { isEdgeCase: false },
        orderBy: { orderIndex: "asc" },
        take:    3,
      },
    },
  });

  if (!problem) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id:                 problem.id,
    title:              problem.title,
    description:        problem.description,
    starterCode:        problem.starterCode,
    difficultyTier:     problem.difficultyTier,
    expectedComplexity: problem.expectedComplexity,
    conceptTags:        problem.problemConceptTags
      .sort((a, b) => a.conceptTag.sortOrder - b.conceptTag.sortOrder)
      .map((t) => ({ slug: t.conceptTag.slug, label: t.conceptTag.label, sortOrder: t.conceptTag.sortOrder })),
    testCases: problem.testCases.map((tc) => ({
      id:             tc.id,
      input:          tc.input,
      expectedOutput: tc.expectedOutput,
      orderIndex:     tc.orderIndex,
      description:    tc.description,
    })),
  });
}
