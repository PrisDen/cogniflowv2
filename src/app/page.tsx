import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center gap-6 px-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)] flex items-center justify-center">
          <span
            className="material-symbols-outlined text-[#0C0C0C] select-none"
            style={{ fontSize: "20px", fontVariationSettings: "'FILL' 1" }}
          >
            psychology
          </span>
        </div>
        <span className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          Cogniflow
        </span>
      </div>

      {/* Headline */}
      <div className="text-center max-w-sm">
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] mb-2">
          Practice how you code.
          <br />
          Understand how you learn.
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Cogniflow gives you honest feedback on your process — not just your outcome.
          Spot patterns, close gaps, build fluency.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex gap-3 mt-2">
        <Link
          href="/signup"
          className="px-5 py-2.5 rounded-lg bg-[var(--color-primary)] text-[#0C0C0C] text-sm font-semibold hover:bg-[var(--color-primary-hover)] transition-colors"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="px-5 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] text-sm hover:text-[var(--color-text-primary)] hover:border-[#3A3A3A] transition-colors"
        >
          Sign in
        </Link>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mt-2">Free. No grades. No rankings.</p>
    </main>
  );
}
