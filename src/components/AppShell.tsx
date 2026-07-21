"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

export type NavLink = { href: string; label: string };

export function AppShell({
  brand,
  userName,
  role,
  links,
  children,
}: {
  brand: string;
  userName: string;
  role: string;
  links: NavLink[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="text-white shadow"
        style={{ background: "var(--brand-primary)" }}
      >
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2 font-semibold">
              <span>{brand}</span>
              <span className="text-xs opacity-70 uppercase tracking-wide">{role}</span>
            </div>

            {/* Desktop / tablet nav */}
            <nav className="hidden md:flex items-center gap-4" aria-label="Primary">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="hover:underline">
                  {l.label}
                </Link>
              ))}
              <span className="opacity-80">{userName}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="rounded bg-white/15 px-3 py-1 hover:bg-white/25"
              >
                Sign out
              </button>
            </nav>

            {/* Phone hamburger */}
            <button
              className="md:hidden inline-flex items-center justify-center rounded p-2 hover:bg-white/15"
              aria-label="Toggle menu"
              aria-expanded={open}
              data-testid="nav-toggle"
              onClick={() => setOpen((v) => !v)}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {open ? (
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>

          {/* Phone dropdown menu */}
          {open && (
            <nav
              className="md:hidden pb-3 flex flex-col gap-2"
              aria-label="Mobile"
              data-testid="mobile-menu"
            >
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="py-1 hover:underline"
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </Link>
              ))}
              <span className="opacity-80 py-1">{userName}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-left rounded bg-white/15 px-3 py-1 hover:bg-white/25 w-fit"
              >
                Sign out
              </button>
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
