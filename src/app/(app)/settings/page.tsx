import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/settings/SettingsClient";

export default async function SettingsPage() {
  const session = await auth();
  const userId  = session!.user.id;

  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { email: true, displayName: true },
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-[var(--color-text-primary)] tracking-tight">Settings</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Manage your account preferences and personal details.
        </p>
      </div>

      <SettingsClient
        initialDisplayName={user.displayName ?? ""}
        email={user.email}
      />
    </div>
  );
}
