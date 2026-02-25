import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/settings/account
 *
 * Hard-deletes the authenticated user and all their associated data.
 * Prisma cascade deletes handle sessions → events, insights, gaps.
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Cascade: sessions → events, insights, gaps — all handled by DB foreign keys
  await prisma.user.delete({ where: { id: userId } });

  return NextResponse.json({ ok: true });
}
