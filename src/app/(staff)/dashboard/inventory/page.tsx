import { getSessionContext } from "@/lib/auth";
import { getInventoryPageData } from "@/lib/inventory";
import { InventoryManager } from "@/components/InventoryManager";

export default async function InventoryPage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const data = await getInventoryPageData(ctx);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Inventory</h1>
      <p className="text-gray-500 mb-6">
        Manage your products, adjust stock with reasons, and link products that
        services consume. Shared stock at your locations is adjustable too.
      </p>
      <InventoryManager
        role={data.role}
        items={data.items}
        ownerOptions={data.ownerOptions}
        services={data.services}
        myUserId={data.myUserId}
      />
    </section>
  );
}
