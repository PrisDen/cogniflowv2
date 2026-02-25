import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const record = await prisma.session.findFirst({
    where: { id, userId: session.user.id },
    include: {
      problem:  { select: { id: true, title: true } },
      insights: { orderBy: { priority: "asc" } },
      events:   { select: { type: true }, where: { type: "run" } },
    },
  });

  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const durationMin = record.endedAt
    ? Math.round((record.endedAt.getTime() - record.startedAt.getTime()) / 60_000)
    : null;

  return NextResponse.json({
    sessionId:    record.id,
    problemId:    record.problem.id,
    problemTitle: record.problem.title,
    outcome:      record.outcome,
    durationMin,
    runCount:     record.events.length,
    insights:     record.insights.map((i) => ({
      priority:    i.priority,
      observation: i.observation,
      message:     i.message,
    })),
    checkin: {
      feel:        record.checkinFeel,
      preWork:     record.checkinPreWork,
      interrupted: record.checkinInterrupted,
      confidence:  record.checkinConfidence,
    },
  });
}
