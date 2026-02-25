import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();
  const name = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "there";

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
          Welcome back, {name}
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Track your progress and keep practising.
        </p>
      </div>

      {/* Empty state */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 text-center">
        <span
          className="material-symbols-outlined text-[var(--color-primary)] block mb-3"
          style={{ fontSize: "40px", fontVariationSettings: "'FILL' 1" }}
        >
          code
        </span>
        <p className="text-[var(--color-text-primary)] font-medium mb-1">
          You haven&apos;t solved any problems yet.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-5 max-w-sm mx-auto">
          Start with your first one — the insights get better the more sessions you have.
        </p>
        <a
          href="/problems"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[var(--color-primary)] text-[#0C0C0C] text-sm font-semibold rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors"
        >
          Browse Problems
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>arrow_forward</span>
        </a>
      </div>
    </div>
  );
}
