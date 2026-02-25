import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runAgainstTestCases } from "@/lib/piston";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    problemId?:        string;
    code?:             string;
    includeEdgeCases?: boolean;
  };

  if (!body.problemId || body.code === undefined) {
    return NextResponse.json({ error: "problemId and code required" }, { status: 400 });
  }

  // Fetch problem + test cases from DB
  const problem = await prisma.problem.findUnique({
    where:   { id: body.problemId, isActive: true },
    include: {
      testCases: {
        where:   body.includeEdgeCases ? {} : { isEdgeCase: false },
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  if (!problem) return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  if (problem.testCases.length === 0) {
    return NextResponse.json({ error: "No test cases" }, { status: 400 });
  }

  try {
    const result = await runAgainstTestCases(
      body.code,
      problem.starterCode,
      problem.testCases.map((tc) => ({
        id:             tc.id,
        input:          tc.input,
        expectedOutput: tc.expectedOutput,
        isEdgeCase:     tc.isEdgeCase,
        description:    tc.description,
      })),
    );

    return NextResponse.json(result);
  } catch (e) {
    console.error("[/api/run] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg === "JUDGE0_UNREACHABLE" || msg === "PISTON_UNREACHABLE") {
      return NextResponse.json({ error: "Code runner is temporarily unavailable. Try again in a moment." }, { status: 503 });
    }
    return NextResponse.json({ error: "Execution failed." }, { status: 500 });
  }
}
