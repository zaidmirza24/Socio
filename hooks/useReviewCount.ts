"use client";

import { useState, useEffect } from "react";

/**
 * Module-level singleton so every component that calls this hook
 * shares a single fetch interval — no duplicate requests when
 * both the desktop SidebarNav and the mobile SidebarNav are mounted.
 */
let cachedCount = 0;
let isFetching = false;
let lastFetchedAt = 0;
const STALE_MS = 60_000; // treat the count as fresh for 60 s

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function notifyAll(count: number) {
  cachedCount = count;
  listeners.forEach((l) => l(count));
}

async function doFetch() {
  if (isFetching) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

  const now = Date.now();
  if (now - lastFetchedAt < STALE_MS) {
    // Still fresh — just broadcast the cached value to any new subscriber
    listeners.forEach((l) => l(cachedCount));
    return;
  }

  isFetching = true;
  try {
    const res = await fetch("/api/review-queue/count");
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.count === "number") {
        lastFetchedAt = Date.now();
        notifyAll(data.count);
      }
    }
  } catch {
    // Silently ignore network hiccups
  } finally {
    isFetching = false;
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;

function ensurePolling() {
  if (intervalHandle !== null) return; // already running

  intervalHandle = setInterval(doFetch, STALE_MS);

  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      // Reset stale timer so the next doFetch call actually hits the API
      lastFetchedAt = 0;
      doFetch();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

function teardownPolling() {
  if (listeners.size > 0) return; // other consumers still active

  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (visibilityHandler !== null) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

/**
 * Returns the live pending review count.
 * Multiple instances share a single background poll — opening the
 * mobile sidebar does NOT trigger a second fetch.
 */
export function useReviewCount(): number {
  const [count, setCount] = useState<number>(cachedCount);

  useEffect(() => {
    const listener: Listener = (n) => setCount(n);
    listeners.add(listener);
    ensurePolling();

    // Kick off a fetch immediately (respects the stale window)
    doFetch();

    return () => {
      listeners.delete(listener);
      teardownPolling();
    };
  }, []);

  return count;
}
