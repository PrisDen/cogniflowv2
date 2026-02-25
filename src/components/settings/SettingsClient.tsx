"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

// ── Tiny inline toast ──────────────────────────────────────────────────────

type ToastState = { message: string; type: "success" | "error" } | null;

function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  function show(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  return { toast, show };
}

// ── Shared UI atoms ────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-6 p-6 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      {children}
    </section>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] pb-4">
      <span className="material-symbols-outlined text-[var(--color-text-muted)]" style={{ fontSize: "20px" }}>
        {icon}
      </span>
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-[var(--color-text-secondary)]">{children}</span>
  );
}

const inputClass = [
  "w-full rounded-lg px-3.5 py-2.5 text-sm",
  "bg-[var(--color-surface-elevated)] border border-[var(--color-border)]",
  "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
  "focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]",
  "transition-colors",
].join(" ");

const inputReadonlyClass = [
  "w-full rounded-lg px-3.5 py-2.5 text-sm",
  "bg-[var(--color-surface)] border border-[var(--color-border-subtle)]",
  "text-[var(--color-text-muted)] cursor-not-allowed",
].join(" ");

function ActionButton({
  onClick,
  loading,
  children,
  disabled,
}: {
  onClick: () => void;
  loading: boolean;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? "Saving…" : children}
    </button>
  );
}

function InlineToast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <p className={[
      "text-xs font-medium",
      toast.type === "success" ? "text-[#4ADE80]" : "text-[#F87171]",
    ].join(" ")}>
      {toast.message}
    </p>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface SettingsClientProps {
  initialDisplayName: string;
  email:              string;
}

export function SettingsClient({ initialDisplayName, email }: SettingsClientProps) {
  return (
    <div className="flex flex-col gap-6">
      <AccountSection initialDisplayName={initialDisplayName} email={email} />
      <PasswordSection />
      <DataSection />
    </div>
  );
}

// ── Account section ────────────────────────────────────────────────────────

function AccountSection({ initialDisplayName, email }: { initialDisplayName: string; email: string }) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [loading, setLoading]         = useState(false);
  const { toast, show }               = useToast();

  async function handleSave() {
    if (!displayName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ displayName: displayName.trim() }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        show(data.error ?? "Something went wrong.", "error");
      } else {
        show("Display name saved.", "success");
      }
    } catch {
      show("Network error. Try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard>
      <SectionHeader icon="person" title="Account" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Display name</FieldLabel>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            placeholder="Your name"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <FieldLabel>Email</FieldLabel>
          <input
            type="email"
            value={email}
            readOnly
            className={inputReadonlyClass}
          />
        </label>
      </div>

      <div className="flex items-center gap-4">
        <ActionButton onClick={handleSave} loading={loading} disabled={!displayName.trim()}>
          Save changes
        </ActionButton>
        <InlineToast toast={toast} />
      </div>
    </SectionCard>
  );
}

// ── Password section ───────────────────────────────────────────────────────

function PasswordSection() {
  const [current,  setCurrent]  = useState("");
  const [next,     setNext]     = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const { toast, show }         = useToast();

  async function handleUpdate() {
    if (next !== confirm) {
      show("New passwords don't match.", "error");
      return;
    }
    if (next.length < 8) {
      show("Password must be at least 8 characters.", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/settings/password", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        show(data.error ?? "Something went wrong.", "error");
      } else {
        show("Password updated.", "success");
        setCurrent(""); setNext(""); setConfirm("");
      }
    } catch {
      show("Network error. Try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = current && next && confirm;

  return (
    <SectionCard>
      <SectionHeader icon="lock" title="Password" />

      <div className="flex flex-col gap-4 max-w-sm">
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Current password</FieldLabel>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
            autoComplete="current-password"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <FieldLabel>New password</FieldLabel>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="Min. 8 characters"
            className={inputClass}
            autoComplete="new-password"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <FieldLabel>Confirm new password</FieldLabel>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
            autoComplete="new-password"
          />
        </label>
      </div>

      <div className="flex items-center gap-4">
        <ActionButton onClick={handleUpdate} loading={loading} disabled={!canSubmit}>
          Update password
        </ActionButton>
        <InlineToast toast={toast} />
      </div>
    </SectionCard>
  );
}

// ── Data / danger zone section ─────────────────────────────────────────────

function DataSection() {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);
  const { toast, show }             = useToast();

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/account", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        show(data.error ?? "Something went wrong.", "error");
        setConfirming(false);
      } else {
        // Account deleted — sign out and redirect to landing
        await signOut({ redirectTo: "/" });
      }
    } catch {
      show("Network error. Try again.", "error");
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard>
      <SectionHeader icon="database" title="Your data" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed max-w-lg">
          Permanently delete your account and all associated data — sessions, insights, gap history.
          This action cannot be undone.
        </p>

        {confirming ? (
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-[var(--color-text-secondary)]">Are you sure?</span>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-[#EF4444] text-sm font-medium hover:bg-[rgba(239,68,68,0.18)] disabled:opacity-40 transition-colors"
            >
              {loading ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-[#EF4444] border border-transparent hover:bg-[rgba(239,68,68,0.08)] hover:border-[rgba(239,68,68,0.15)] transition-colors"
          >
            Delete account
          </button>
        )}
      </div>

      <InlineToast toast={toast} />
    </SectionCard>
  );
}
