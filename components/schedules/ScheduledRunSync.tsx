"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const SYNC_EVERY_MS = 60_000;

interface SyncResponse {
  registered?: number;
  ingested?: number;
  completed?: number;
  resynced?: number;
}

/**
 * Renders nothing. While an admin has the dashboard open it asks the server once a minute to record
 * the runs Apify's schedules have started and to save the finished ones. Mounted for admins only;
 * it stops for good if the server says the login is gone or the user is not an admin.
 */
export function ScheduledRunSync() {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      if (stopped.current) return;
      // A hidden tab is not watching anything; skip the call and check again later.
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/scraper/schedules/sync", { method: "POST" });
          if (res.status === 401 || res.status === 403 || res.redirected) {
            stopped.current = true;
            return;
          }
          if (res.ok) {
            const data = (await res.json()) as SyncResponse;
            if ((data.ingested ?? 0) > 0 || (data.completed ?? 0) > 0 || (data.resynced ?? 0) > 0) {
              router.refresh();
            }
          }
        } catch {
          // Offline or a server hiccup: try again next minute.
        }
      }
      if (!stopped.current) timer = setTimeout(() => void tick(), SYNC_EVERY_MS);
    };

    timer = setTimeout(() => void tick(), 5_000);
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return null;
}
