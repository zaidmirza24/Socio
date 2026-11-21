"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/ErrorState";

/** Catches any unexpected error while rendering a dashboard page, keeping the sidebar and top bar usable. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl pt-8">
      <ErrorState
        title="This page couldn't be shown"
        message="Something unexpected went wrong while loading this page. Your data is safe. Try again, or go back to the dashboard."
        detail={error.digest}
        onRetry={reset}
      >
        <Link href="/dashboard" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Go to Dashboard
        </Link>
      </ErrorState>
    </div>
  );
}
