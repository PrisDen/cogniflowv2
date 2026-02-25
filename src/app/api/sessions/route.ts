import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { problemId } = await req.json() as { problemId?: string };
  if (!problemId) return NextResponse.json({ error: "problemId required" }, { status: 400 });

  const problem = await prisma.problem.findUnique({ where: { id: problemId, isActive: true } });
  if (!problem) return NextResponse.json({ error: "Problem not found" }, { status: 404 });

  const newSession = await prisma.session.create({
    data: { userId: session.user.id, problemId },
    select: { id: true, startedAt: true },
  });

  return NextResponse.json(newSession, { status: 201 });
}
