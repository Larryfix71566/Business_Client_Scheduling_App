import { getSessionContext } from "@/lib/auth";
import { getScheduleEditorData } from "@/lib/schedule";
import { ScheduleEditor } from "@/components/ScheduleEditor";

export default async function SchedulePage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const data = await getScheduleEditorData(ctx);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Your schedule</h1>
      <p className="text-gray-500 mb-6">
        Set your weekly availability per location, add date-specific overrides,
        and control your booking approval and deposit settings.
      </p>
      <ScheduleEditor
        locations={data.locations}
        schedules={data.schedules}
        settings={data.settings}
      />
    </section>
  );
}
