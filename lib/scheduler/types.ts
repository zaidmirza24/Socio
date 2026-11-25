import type { PlatformType } from "../../types/database.ts";
import type { PlannedEntry, ScheduleMode } from "./plan.ts";

export type ScheduleStatus = "active" | "paused" | "completed" | "error";

/** One Apify Schedule that belongs to a Socio schedule. */
export interface ApifyScheduleEntry extends PlannedEntry {
  /** Apify's schedule id. */
  scheduleId: string;
}

/** A schedule as the API returns it (and the page shows it). */
export interface ScheduleDto {
  id: string;
  name: string;
  mode: ScheduleMode;
  startDate: string;
  endDate: string;
  runTime: string;
  /** Minutes between platforms on a run day. */
  gapMinutes: number;
  platforms: PlatformType[];
  status: ScheduleStatus;
  /** Accounts frozen into each platform's actor input when the schedule was last saved. */
  handleCounts: Partial<Record<PlatformType, number>>;
  /** The time each selected platform fires, IST, in run order. */
  platformTimes: { platform: PlatformType; time: string }[];
  /** How many Apify schedules back this one (one per platform per calendar month). */
  apifyScheduleCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface SyncResult {
  /** Scheduled runs found at Apify and recorded for the first time. */
  registered: number;
  /** Runs saved to the database during this sync. */
  ingested: number;
  /** Schedules whose end date passed (their Apify schedules were deleted). */
  completed: number;
  /** Schedules whose frozen account list was refreshed because accounts changed. */
  resynced: number;
  errors: string[];
}
