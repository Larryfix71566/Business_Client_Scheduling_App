// Public booking pages: no auth. A light shell so customers see the business
// context. (Per-user/location branding lands in Phase 8.)
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="text-white shadow" style={{ background: "var(--brand-primary)" }}>
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center font-semibold">
          Book an appointment
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
