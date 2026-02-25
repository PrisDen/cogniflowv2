import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { outcome?: string };

  const VALID_OUTCOMES = ["passed", "failed", "abandoned"] as const;
  if (body.outcome && !VALID_OUTCOMES.includes(body.outcome as (typeof VALID_OUTCOMES)[number])) {
    return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
  }

  const updated = await prisma.session.updateMany({
    where: { id, userId: session.user.id },
    data:  {
      outcome:  body.outcome as "passed" | "failed" | "abandoned" | undefined,
      endedAt:  new Date(),
    },
  });

  if (updated.count === 0) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
