import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  } | null;

  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword     = typeof body?.newPassword     === "string" ? body.newPassword     : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: session.user.id },
    data:  { passwordHash: newHash },
  });

  return NextResponse.json({ ok: true });
}
