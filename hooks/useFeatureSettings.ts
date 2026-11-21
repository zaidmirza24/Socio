"use client";

import { useState, useEffect } from "react";

export interface FeatureFlags {
  campaign_captions_enabled: boolean;
}

let cached: FeatureFlags = { campaign_captions_enabled: true };
let inflight: Promise<void> | null = null;
const listeners = new Set<(f: FeatureFlags) => void>();

/** Broadcast new flags to every mounted consumer (call after an admin changes a toggle). */
export function setFeatureFlags(next: FeatureFlags): void {
  cached = next;
  listeners.forEach((l) => l(next));
}

async function load(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/settings/features");
      if (res.ok) {
        const data = (await res.json()) as Partial<FeatureFlags>;
        setFeatureFlags({
          campaign_captions_enabled: data.campaign_captions_enabled ?? true,
        });
      }
    } catch {
      // keep defaults
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Shared feature flags; defaults to everything on until loaded. */
export function useFeatureSettings(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(cached);

  useEffect(() => {
    listeners.add(setFlags);
    void load();
    return () => {
      listeners.delete(setFlags);
    };
  }, []);

  return flags;
}
