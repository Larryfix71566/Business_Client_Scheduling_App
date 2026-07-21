"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

export default function RegisterPage() {
  const [form, setForm] = useState({
    businessName: "",
    locationName: "Main Location",
    address: "",
    timezone: "America/New_York",
    adminName: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setBusy(false);
      setError(data.error ?? "Could not create the business. Check your inputs.");
      return;
    }
    const signInRes = await signIn("credentials", {
      email: form.email,
      password: form.password,
      redirect: false,
    });
    setBusy(false);
    if (!signInRes || signInRes.error) {
      window.location.href = "/login";
      return;
    }
    window.location.href = "/";
  }

  const field = "mb-3 w-full rounded border border-gray-300 px-3 py-2";
  const label = "block text-sm font-medium mb-1";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow"
        aria-labelledby="register-heading"
      >
        <h1 id="register-heading" className="text-xl font-semibold mb-4">
          Create your business
        </h1>

        {error && (
          <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className={label} htmlFor="businessName">Business name</label>
        <input id="businessName" required className={field}
          value={form.businessName} onChange={(e) => set("businessName", e.target.value)} />

        <label className={label} htmlFor="locationName">First location name</label>
        <input id="locationName" required className={field}
          value={form.locationName} onChange={(e) => set("locationName", e.target.value)} />

        <label className={label} htmlFor="address">Location address</label>
        <input id="address" required className={field}
          value={form.address} onChange={(e) => set("address", e.target.value)} />

        <label className={label} htmlFor="adminName">Your name</label>
        <input id="adminName" required className={field}
          value={form.adminName} onChange={(e) => set("adminName", e.target.value)} />

        <label className={label} htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required className={field}
          value={form.email} onChange={(e) => set("email", e.target.value)} />

        <label className={label} htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={8} className={field}
          value={form.password} onChange={(e) => set("password", e.target.value)} />

        <button type="submit" disabled={busy}
          className="mt-2 w-full rounded px-3 py-2 font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}>
          {busy ? "Creating..." : "Create business"}
        </button>

        <p className="mt-4 text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
