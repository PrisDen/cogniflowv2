import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { displayName?: unknown } | null;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : null;

  if (!displayName || displayName.length < 1 || displayName.length > 50) {
    return NextResponse.json(
      { error: "Display name must be between 1 and 50 characters." },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data:  { displayName },
  });

  return NextResponse.json({ ok: true });
}
