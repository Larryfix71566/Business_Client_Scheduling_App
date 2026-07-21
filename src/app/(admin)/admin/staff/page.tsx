"use client";

import { useState } from "react";

type Result = { email: string; name: string; tempPassword: string };

export default function StaffInvitePage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    requiresApproval: false,
    depositEnabled: false,
    depositCents: 0,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok || !data.ok) {
      setError(data.error ?? "Could not create the staff account.");
      return;
    }
    setResult({ email: data.email, name: data.name, tempPassword: data.tempPassword });
    setForm({ name: "", email: "", requiresApproval: false, depositEnabled: false, depositCents: 0 });
  }

  const field = "mb-3 w-full rounded border border-gray-300 px-3 py-2";
  const label = "block text-sm font-medium mb-1";

  return (
    <section className="max-w-md">
      <h1 className="text-2xl font-semibold mb-1">Invite staff</h1>
      <p className="text-gray-500 mb-6">Create a staff (USER) account with a one-time temporary password.</p>

      {result && (
        <div role="status" className="mb-5 rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="font-medium text-green-800">Account created for {result.name}</p>
          <p className="text-sm text-green-800">Email: {result.email}</p>
          <p className="mt-2 text-sm text-green-900">
            Temporary password (shown once):{" "}
            <code className="rounded bg-white px-2 py-1 font-mono" data-testid="temp-password">
              {result.tempPassword}
            </code>
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="rounded-lg bg-white p-6 shadow">
        <label className={label} htmlFor="name">Name</label>
        <input id="name" required className={field}
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

        <label className={label} htmlFor="email">Email</label>
        <input id="email" type="email" required className={field}
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

        <label className="flex items-center gap-2 mb-2 text-sm">
          <input type="checkbox" checked={form.requiresApproval}
            onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} />
          Requires approval for bookings
        </label>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={form.depositEnabled}
            onChange={(e) => setForm({ ...form, depositEnabled: e.target.checked })} />
          Deposits enabled
        </label>

        {form.depositEnabled && (
          <>
            <label className={label} htmlFor="depositCents">Deposit amount (cents)</label>
            <input id="depositCents" type="number" min={0} className={field}
              value={form.depositCents}
              onChange={(e) => setForm({ ...form, depositCents: Number(e.target.value) })} />
          </>
        )}

        <button type="submit" disabled={busy}
          className="mt-2 w-full rounded px-3 py-2 font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}>
          {busy ? "Creating..." : "Create staff account"}
        </button>
      </form>
    </section>
  );
}
