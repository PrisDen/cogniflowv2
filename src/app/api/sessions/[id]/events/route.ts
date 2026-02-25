import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { EventType } from "@/types/session";

const VALID_TYPES: EventType[] = ["first_keystroke", "paste", "snapshot", "run", "submit"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { type?: string; occurredAt?: string; metadata?: Record<string, unknown> };

  if (!body.type || !VALID_TYPES.includes(body.type as EventType)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  // Verify the session belongs to this user
  const sessionRecord = await prisma.session.findFirst({ where: { id, userId: session.user.id } });
  if (!sessionRecord) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  await prisma.sessionEvent.create({
    data: {
      sessionId:  id,
      type:       body.type as EventType,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      metadata:   body.metadata ?? {},
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
