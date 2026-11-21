"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  /** What went wrong, in plain words. */
  message?: ReactNode;
  /** Shows a "Try again" button. */
  onRetry?: () => void;
  /** Extra detail (e.g. an error digest) for whoever reports the problem. */
  detail?: string;
  /** Smaller, for use inside a table or card. */
  compact?: boolean;
  children?: ReactNode;
}

/** Full-width failure message with a way forward. Used when a whole view could not load. */
export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this. Check your connection and try again.",
  onRetry,
  detail,
  compact,
  children,
}: ErrorStateProps) {
  return (
    <div role="alert" className={`rounded-xl border border-red-200 bg-red-50/60 text-center ${compact ? "p-6" : "p-10"}`}>
      <AlertTriangle className="mx-auto h-8 w-8 text-red-500" aria-hidden="true" />
      <h2 className="mt-3 text-base font-bold text-slate-900">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{message}</p>
      {detail && <p className="mt-2 font-mono text-xs text-slate-500">Reference: {detail}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
