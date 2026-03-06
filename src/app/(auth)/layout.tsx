import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 mb-8 hover:opacity-80 transition-opacity">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)] flex items-center justify-center">
          <span
            className="material-symbols-outlined text-[#0C0C0C] select-none"
            style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}
          >
            psychology
          </span>
        </div>
        <span className="text-base font-semibold text-[var(--color-text-primary)] tracking-tight">
          Cogniflow
        </span>
      </Link>

      {/* Card */}
      <div className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8">
        {children}
      </div>
    </div>
  );
}
