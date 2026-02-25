export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-3">
        {/* Logo mark */}
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-[#0C0C0C] text-lg font-bold select-none">C</span>
        </div>
        <span className="text-xl font-semibold tracking-tight text-text-primary">
          Cogniflow
        </span>
      </div>
      <p className="text-text-secondary text-sm text-center max-w-sm">
        Practice how you code. Understand how you learn.
      </p>
      <div className="flex gap-3 mt-2">
        <a
          href="/signup"
          className="px-4 py-2 rounded-lg bg-primary text-[#0C0C0C] text-sm font-semibold hover:bg-primary-hover transition-colors"
        >
          Get started
        </a>
        <a
          href="/login"
          className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm hover:text-text-primary hover:border-[#3A3A3A] transition-colors"
        >
          Sign in
        </a>
      </div>
    </main>
  );
}
