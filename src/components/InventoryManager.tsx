"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarcodeScanner } from "./BarcodeScanner";

type ItemRow = {
  id: string;
  name: string;
  barcode: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  costCents: number;
  priceCents: number;
  costLabel: string;
  priceLabel: string;
  qtyOnHand: number;
  lowStockAt: number;
  lowStock: boolean;
  ownerType: "location" | "user";
  ownerId: string;
  ownerName: string;
  editable: boolean;
  adjustable: boolean;
};

type OwnerOptions = {
  locations: { id: string; name: string }[];
  users: { id: string; name: string }[];
  canCreateShared: boolean;
};

type Props = {
  role: string;
  items: ItemRow[];
  ownerOptions: OwnerOptions;
  services: { id: string; name: string }[];
  myUserId: string;
};

const REASONS = ["RECEIVED", "SOLD", "DAMAGED", "MANUAL"] as const;
const inputCls = "rounded border border-gray-300 px-2 py-1 text-sm";
const btnPrimary =
  "rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-60";

export function InventoryManager({ role, items, ownerOptions, services, myUserId }: Props) {
  return (
    <div className="space-y-8">
      <CreateItemForm role={role} ownerOptions={ownerOptions} myUserId={myUserId} />

      <section>
        <h2 className="text-lg font-semibold mb-3">Items</h2>
        {items.length === 0 ? (
          <p className="text-gray-500" data-testid="inventory-empty">
            No items yet. Add your first product above.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="inventory-list">
            {items.map((it) => (
              <ItemCard key={it.id} item={it} />
            ))}
          </ul>
        )}
      </section>

      {services.length > 0 && <ServiceRecipes services={services} items={items} />}
    </div>
  );
}

// --------------------------------------------------------------------------

function LowBadge() {
  return (
    <span
      className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
      data-testid="low-stock-badge"
    >
      Low stock
    </span>
  );
}

// --------------------------------------------------------------------------

function CreateItemForm({
  role,
  ownerOptions,
  myUserId,
}: {
  role: string;
  ownerOptions: OwnerOptions;
  myUserId: string;
}) {
  const router = useRouter();
  const isAdmin = role === "ADMIN";

  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [costCents, setCostCents] = useState(0);
  const [priceCents, setPriceCents] = useState(0);
  const [lowStockAt, setLowStockAt] = useState(0);
  const [qtyOnHand, setQtyOnHand] = useState(0);
  // Admin owner selection encoded as "loc:<id>" or "user:<id>".
  const defaultOwner = isAdmin
    ? ownerOptions.locations[0]
      ? `loc:${ownerOptions.locations[0].id}`
      : `user:${myUserId}`
    : `user:${myUserId}`;
  const [owner, setOwner] = useState(defaultOwner);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function uploadPhoto(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/inventory/photo", { method: "POST", body: fd });
    const data = await res.json();
    if (res.ok && data.ok) {
      setPhotoPath(data.photoPath);
      setPhotoUrl(data.url);
      setMsg(null);
    } else {
      setMsg(data.error ?? "Photo upload failed");
    }
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    const body: Record<string, unknown> = {
      name,
      barcode: barcode || undefined,
      photoPath: photoPath || undefined,
      costCents,
      priceCents,
      lowStockAt,
      qtyOnHand,
    };
    if (isAdmin) {
      if (owner.startsWith("loc:")) body.locationId = owner.slice(4);
      else body.userId = owner.slice(5);
    }
    const res = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      setName("");
      setBarcode("");
      setPhotoPath(null);
      setPhotoUrl(null);
      setCostCents(0);
      setPriceCents(0);
      setLowStockAt(0);
      setQtyOnHand(0);
      setMsg("Item created");
      router.refresh();
    } else {
      setMsg(data.error ?? "Could not create item");
    }
  }

  return (
    <section className="rounded-lg bg-white p-6 shadow" data-testid="create-item-form">
      <h2 className="text-lg font-semibold mb-4">Add an item</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="block mb-1 font-medium">Name</span>
          <input
            id="item-name"
            className={`${inputCls} w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="item-name"
          />
        </label>

        {isAdmin && (
          <label className="text-sm">
            <span className="block mb-1 font-medium">Owner</span>
            <select
              className={`${inputCls} w-full`}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              data-testid="item-owner"
            >
              {ownerOptions.canCreateShared &&
                ownerOptions.locations.map((l) => (
                  <option key={`loc:${l.id}`} value={`loc:${l.id}`}>
                    {l.name} (shared)
                  </option>
                ))}
              {ownerOptions.users.map((u) => (
                <option key={`user:${u.id}`} value={`user:${u.id}`}>
                  {u.name} (own)
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-sm">
          <span className="block mb-1 font-medium">Barcode</span>
          <input
            id="item-barcode"
            className={`${inputCls} w-full`}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            data-testid="item-barcode"
            placeholder="Scan or type"
          />
        </label>

        <div className="text-sm">
          <span className="block mb-1 font-medium">Camera scan (optional)</span>
          <BarcodeScanner onDetected={(v) => setBarcode(v)} />
        </div>

        <label className="text-sm">
          <span className="block mb-1 font-medium">Cost (cents)</span>
          <input
            type="number"
            min={0}
            className={`${inputCls} w-full`}
            value={costCents}
            onChange={(e) => setCostCents(Number(e.target.value))}
            data-testid="item-cost"
          />
        </label>

        <label className="text-sm">
          <span className="block mb-1 font-medium">Price (cents)</span>
          <input
            type="number"
            min={0}
            className={`${inputCls} w-full`}
            value={priceCents}
            onChange={(e) => setPriceCents(Number(e.target.value))}
            data-testid="item-price"
          />
        </label>

        <label className="text-sm">
          <span className="block mb-1 font-medium">Starting quantity</span>
          <input
            type="number"
            className={`${inputCls} w-full`}
            value={qtyOnHand}
            onChange={(e) => setQtyOnHand(Number(e.target.value))}
            data-testid="item-qty"
          />
        </label>

        <label className="text-sm">
          <span className="block mb-1 font-medium">Low-stock at</span>
          <input
            type="number"
            min={0}
            className={`${inputCls} w-full`}
            value={lowStockAt}
            onChange={(e) => setLowStockAt(Number(e.target.value))}
            data-testid="item-lowstock"
          />
        </label>

        <label className="text-sm">
          <span className="block mb-1 font-medium">Photo (optional)</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadPhoto(f);
            }}
            data-testid="item-photo"
          />
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="preview" className="mt-2 h-16 w-16 rounded object-cover" />
          )}
        </label>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !name}
          className={btnPrimary}
          style={{ background: "var(--brand-primary)" }}
          data-testid="create-item-btn"
        >
          {busy ? "Saving..." : "Add item"}
        </button>
        {msg && <span className="text-sm text-gray-600" data-testid="create-item-msg">{msg}</span>}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------

function ItemCard({ item }: { item: ItemRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  return (
    <li className="rounded-lg bg-white p-4 shadow" data-testid="inventory-item" data-item-name={item.name}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          {item.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photoUrl} alt="" className="h-14 w-14 rounded object-cover" />
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{item.name}</span>
              {item.lowStock && <LowBadge />}
            </div>
            <div className="text-sm text-gray-500">
              {item.ownerType === "user" ? "Own" : "Shared"} · {item.ownerName}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              Price {item.priceLabel} · Cost {item.costLabel}
              {item.barcode ? ` · Barcode ${item.barcode}` : ""}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold" data-testid="item-qty-value">
            {item.qtyOnHand}
          </div>
          <div className="text-xs text-gray-500">on hand (low ≤ {item.lowStockAt})</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {item.adjustable && <AdjustForm item={item} onDone={() => router.refresh()} />}
        {item.editable && (
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline"
            onClick={() => setEditing((v) => !v)}
            data-testid="edit-toggle"
          >
            {editing ? "Cancel edit" : "Edit"}
          </button>
        )}
        {item.editable && <DeleteButton item={item} onDone={() => router.refresh()} />}
      </div>

      {editing && item.editable && (
        <EditForm
          item={item}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}

function AdjustForm({ item, onDone }: { item: ItemRow; onDone: () => void }) {
  const [reason, setReason] = useState<(typeof REASONS)[number]>("RECEIVED");
  const [delta, setDelta] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setMsg(null);
    // SOLD/DAMAGED consume stock → negative delta; RECEIVED/MANUAL add.
    const signed = reason === "SOLD" || reason === "DAMAGED" ? -Math.abs(delta) : Math.abs(delta);
    const res = await fetch("/api/inventory/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, delta: signed, reason }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      onDone();
    } else {
      setMsg(data.error ?? "Adjustment failed");
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="adjust-form">
      <select
        className={inputCls}
        value={reason}
        onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
        data-testid="adjust-reason"
      >
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        className={`${inputCls} w-20`}
        value={delta}
        onChange={(e) => setDelta(Number(e.target.value))}
        data-testid="adjust-delta"
        aria-label="Quantity"
      />
      <button
        type="button"
        onClick={apply}
        disabled={busy}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
        data-testid="adjust-apply"
      >
        {busy ? "..." : "Apply"}
      </button>
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </div>
  );
}

function DeleteButton({ item, onDone }: { item: ItemRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!confirm(`Delete "${item.name}"?`)) return;
    setBusy(true);
    const res = await fetch("/api/inventory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    });
    setBusy(false);
    if (res.ok) onDone();
  }
  return (
    <button
      type="button"
      onClick={del}
      disabled={busy}
      className="text-sm text-red-600 hover:underline disabled:opacity-60"
      data-testid="delete-item"
    >
      Delete
    </button>
  );
}

function EditForm({ item, onDone }: { item: ItemRow; onDone: () => void }) {
  const [name, setName] = useState(item.name);
  const [barcode, setBarcode] = useState(item.barcode ?? "");
  const [costCents, setCostCents] = useState(item.costCents);
  const [priceCents, setPriceCents] = useState(item.priceCents);
  const [lowStockAt, setLowStockAt] = useState(item.lowStockAt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/inventory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        name,
        barcode: barcode || undefined,
        costCents,
        priceCents,
        lowStockAt,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) onDone();
    else setMsg(data.error ?? "Save failed");
  }

  return (
    <div className="mt-3 grid gap-3 rounded border border-gray-200 p-3 md:grid-cols-2" data-testid="edit-form">
      <label className="text-sm">
        <span className="block mb-1">Name</span>
        <input className={`${inputCls} w-full`} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="block mb-1">Barcode</span>
        <input className={`${inputCls} w-full`} value={barcode} onChange={(e) => setBarcode(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="block mb-1">Cost (cents)</span>
        <input
          type="number"
          min={0}
          className={`${inputCls} w-full`}
          value={costCents}
          onChange={(e) => setCostCents(Number(e.target.value))}
        />
      </label>
      <label className="text-sm">
        <span className="block mb-1">Price (cents)</span>
        <input
          type="number"
          min={0}
          className={`${inputCls} w-full`}
          value={priceCents}
          onChange={(e) => setPriceCents(Number(e.target.value))}
        />
      </label>
      <label className="text-sm">
        <span className="block mb-1">Low-stock at</span>
        <input
          type="number"
          min={0}
          className={`${inputCls} w-full`}
          value={lowStockAt}
          onChange={(e) => setLowStockAt(Number(e.target.value))}
        />
      </label>
      <div className="flex items-end gap-3">
        <button
          onClick={save}
          disabled={busy}
          className={btnPrimary}
          style={{ background: "var(--brand-primary)" }}
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
        {msg && <span className="text-sm text-red-600">{msg}</span>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------

function ServiceRecipes({
  services,
  items,
}: {
  services: { id: string; name: string }[];
  items: ItemRow[];
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [links, setLinks] = useState<{ itemId: string; qty: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  async function load(id: string) {
    setMsg(null);
    const res = await fetch(`/api/inventory/service-products?serviceId=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (res.ok && data.ok) {
      setLinks(data.links.map((l: { itemId: string; qty: number }) => ({ itemId: l.itemId, qty: l.qty })));
    } else {
      setLinks([]);
    }
  }

  // Load the current service's links when the selection changes.
  if (loadedFor !== serviceId && serviceId) {
    setLoadedFor(serviceId);
    load(serviceId);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/inventory/service-products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, links: links.filter((l) => l.itemId && l.qty > 0) }),
    });
    const data = await res.json();
    setBusy(false);
    setMsg(res.ok && data.ok ? "Recipe saved" : data.error ?? "Save failed");
  }

  return (
    <section className="rounded-lg bg-white p-6 shadow" data-testid="service-recipes">
      <h2 className="text-lg font-semibold mb-1">Service recipes</h2>
      <p className="text-sm text-gray-500 mb-4">
        Link the products a service consumes. Stock is decremented at checkout (Phase 6).
      </p>

      <label className="text-sm block mb-4">
        <span className="block mb-1 font-medium">Service</span>
        <select
          className={inputCls}
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          data-testid="recipe-service"
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        {links.map((l, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <select
              className={inputCls}
              value={l.itemId}
              onChange={(e) =>
                setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))
              }
            >
              <option value="">Select item…</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              className={`${inputCls} w-20`}
              value={l.qty}
              aria-label="Quantity consumed"
              onChange={(e) =>
                setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))
              }
            />
            <button
              type="button"
              className="text-sm text-red-600 hover:underline"
              onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-sm hover:underline"
          style={{ color: "var(--brand-primary)" }}
          onClick={() => setLinks((prev) => [...prev, { itemId: "", qty: 1 }])}
        >
          + Add product
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !serviceId}
          className={btnPrimary}
          style={{ background: "var(--brand-primary)" }}
        >
          {busy ? "Saving..." : "Save recipe"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </section>
  );
}
