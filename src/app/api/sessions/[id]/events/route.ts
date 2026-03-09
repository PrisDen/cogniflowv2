import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { EventType } from "@/types/session";

const VALID_TYPES = new Set<EventType>([
  "first_keystroke",
  "paste",
  "snapshot",
  "run",
  "submit",
  // Engagement telemetry
  "window_focus",
  "window_blur",
  "problem_scroll",
  "editor_activity",
]);

interface BatchEventPayload {
  clientEventId: string;
  type:          string;
  occurredAt?:   string;
  metadata?:     Record<string, unknown>;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify the session belongs to this user once, up-front.
  const sessionRecord = await prisma.session.findFirst({ where: { id, userId: session.user.id } });
  if (!sessionRecord) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const body = await req.json() as { events?: BatchEventPayload[] };

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: "events array is required" }, { status: 400 });
  }

  // Accept only known event types; unknown types are silently skipped so a
  // stale client version never causes the entire batch to fail.
  const valid = body.events.filter(e => VALID_TYPES.has(e.type as EventType));

  if (valid.length > 0) {
    await prisma.sessionEvent.createMany({
      data: valid.map(e => ({
        sessionId:  id,
        type:       e.type as EventType,
        occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
        metadata:   (e.metadata ?? {}) as Prisma.InputJsonValue,
      })),
    });
  }

  // Return the clientEventIds that were accepted so the client can remove
  // them from its local queue.
  return NextResponse.json(
    { ok: true, confirmed: valid.map(e => e.clientEventId) },
    { status: 201 },
  );
}
