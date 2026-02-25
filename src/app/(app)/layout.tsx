import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NavBar } from "@/components/ui/NavBar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <NavBar userEmail={session.user.email} />
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
