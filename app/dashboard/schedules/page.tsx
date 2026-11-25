import { CalendarClock } from "lucide-react";
import { SchedulesView } from "@/components/schedules/SchedulesView";
import { isCurrentUserAdmin } from "@/lib/supabase/require-admin";
import { listSchedules } from "@/lib/scheduler/service";
import { getPlatformSettings } from "@/lib/services/settings";
import type { ScheduleDto } from "@/lib/scheduler/types";
import type { PlatformType } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SchedulesPage() {
  if (!(await isCurrentUserAdmin())) {
    return (
      <div className="max-w-xl space-y-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <CalendarClock className="h-5 w-5 text-slate-500" />
          Scheduler is for administrators
        </h1>
        <p className="text-sm text-slate-500">Ask an administrator to set up or change collection schedules.</p>
      </div>
    );
  }

  let schedules: ScheduleDto[] = [];
  let loadError: string | null = null;
  try {
    schedules = await listSchedules();
  } catch (err: unknown) {
    loadError =
      (err instanceof Error ? err.message : "Could not load schedules.") +
      " If the scraper_schedules table is missing, apply the 20261203_scraper_schedules migration.";
  }

  const settings = await getPlatformSettings().catch(() => null);
  const enabledPlatforms: PlatformType[] = ["instagram"];
  if (settings?.facebook?.enabled) enabledPlatforms.push("facebook");
  if (settings?.x?.enabled) enabledPlatforms.push("x");

  return <SchedulesView initialSchedules={schedules} enabledPlatforms={enabledPlatforms} loadError={loadError} />;
}
