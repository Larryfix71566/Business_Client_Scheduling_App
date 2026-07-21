import { getSessionContext } from "@/lib/auth";
import { getApprovalQueue } from "@/lib/appointments";
import { ApprovalQueue } from "@/components/ApprovalQueue";

// Staff approval queue: the user's own REQUESTED appointments, with
// Approve / Decline actions.
export default async function ApprovalsPage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const appts = await getApprovalQueue(ctx);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Approvals</h1>
      <p className="text-gray-500 mb-6">Booking requests waiting on you.</p>
      <ApprovalQueue initial={appts} />
    </section>
  );
}
