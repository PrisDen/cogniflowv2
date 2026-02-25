"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Problems",  href: "/problems"  },
  { label: "Gaps",      href: "/gaps"      },
];

interface NavBarProps {
  userEmail?: string | null;
}

export function NavBar({ userEmail }: NavBarProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 h-14 bg-[var(--color-background)] border-b border-[var(--color-border)]">
      <div className="max-w-6xl mx-auto h-full px-4 flex items-center justify-between">

        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-md bg-[var(--color-primary)] flex items-center justify-center shrink-0">
            <span
              className="material-symbols-outlined text-[#0C0C0C] select-none"
              style={{ fontSize: "15px", fontVariationSettings: "'FILL' 1" }}
            >
              psychology
            </span>
          </div>
          <span className="text-sm font-semibold text-[var(--color-text-primary)] tracking-tight">
            Cogniflow
          </span>
        </Link>

        {/* Nav links */}
        <nav className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "text-[var(--color-primary)] bg-[rgba(167,139,250,0.08)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                ].join(" ")}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className={[
              "p-1.5 rounded-md transition-colors",
              pathname.startsWith("/settings")
                ? "text-[var(--color-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
            title="Settings"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "20px" }}
            >
              settings
            </span>
          </Link>

          <button
            onClick={() => signOut({ redirectTo: "/" })}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            title={userEmail ?? "Log out"}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "16px" }}
            >
              logout
            </span>
            <span>Log out</span>
          </button>
        </div>

      </div>
    </header>
  );
}
