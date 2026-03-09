import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateInsights } from "@/lib/insights";
import { recalculateUserGaps } from "@/lib/gaps";
import type { InsightEvent } from "@/lib/insights";

const VALID_PREWORK = ["paper", "mind", "none"] as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const body = await req.json() as {
    feel?:        number;   // 1–4
    preWork?:     string;   // "paper" | "mind" | "none"
    interrupted?: boolean;
    confidence?:  number;   // 1–4
  };

  // Validate
  if (body.feel && (body.feel < 1 || body.feel > 4))       return NextResponse.json({ error: "Invalid feel" }, { status: 400 });
  if (body.confidence && (body.confidence < 1 || body.confidence > 4)) return NextResponse.json({ error: "Invalid confidence" }, { status: 400 });
  if (body.preWork && !VALID_PREWORK.includes(body.preWork as (typeof VALID_PREWORK)[number])) return NextResponse.json({ error: "Invalid preWork" }, { status: 400 });

  // Verify session belongs to this user
  const sessionRecord = await prisma.session.findFirst({
    where: { id, userId: session.user.id },
    include: {
      events:  true,
      problem: { select: { wordCount: true } },
    },
  });
  if (!sessionRecord) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  // Persist check-in answers
  await prisma.session.update({
    where: { id },
    data: {
      checkinFeel:        body.feel        ?? null,
      checkinPreWork:     (body.preWork as "paper" | "mind" | "none") ?? null,
      checkinInterrupted: body.interrupted ?? null,
      checkinConfidence:  body.confidence  ?? null,
      checkinCompletedAt: new Date(),
    },
  });

  // ── Run insight engine ──────────────────────────────────────────────────
  const insightInput = {
    session: {
      startedAt:          sessionRecord.startedAt,
      endedAt:            sessionRecord.endedAt,
      checkinFeel:        body.feel        ?? null,
      checkinPreWork:     body.preWork     ?? null,
      checkinInterrupted: body.interrupted ?? null,
      checkinConfidence:  body.confidence  ?? null,
    },
    problem: { wordCount: sessionRecord.problem.wordCount },
    events: sessionRecord.events.map((e) => ({
      type:       e.type as string,
      occurredAt: e.occurredAt,
      metadata:   e.metadata as Record<string, unknown>,
    })) as InsightEvent[],
  };

  const { critical, positive } = generateInsights(insightInput);

  // Save insights (upsert so re-submitting check-in is safe).
  // metadata stores evidence signals so the reflection UI can display them.
  if (critical) {
    const metadata = critical.evidence ? { evidence: critical.evidence } : {};
    await prisma.sessionInsight.upsert({
      where:  { sessionId_priority: { sessionId: id, priority: 1 } },
      create: { sessionId: id, priority: 1, observation: critical.observation, message: critical.message, metadata },
      update: { observation: critical.observation, message: critical.message, metadata },
    });
  }

  if (positive) {
    const metadata = positive.evidence ? { evidence: positive.evidence } : {};
    await prisma.sessionInsight.upsert({
      where:  { sessionId_priority: { sessionId: id, priority: 2 } },
      create: { sessionId: id, priority: 2, observation: positive.observation, message: positive.message, metadata },
      update: { observation: positive.observation, message: positive.message, metadata },
    });
  }

  // Recalculate gap stats asynchronously (don't block the response)
  recalculateUserGaps(session.user.id, prisma).catch(console.error);

  return NextResponse.json({ ok: true, insightCount: (critical ? 1 : 0) + (positive ? 1 : 0) });
}
