"use client";

import { useState } from "react";
import { Play, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export function TriggerScraperButton() {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleTrigger = async () => {
    setLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/apify/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to trigger scraper task");
      }

      setStatusMessage({
        type: "success",
        text: `Run started (${data.runId}). Apify is scraping and will notify our webhook when finished.`,
      });
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "An unexpected error occurred",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <button
        onClick={handleTrigger}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Dispatching to Apify...
          </>
        ) : (
          <>
            <Play className="h-4 w-4 fill-current" />
            Trigger Scrape Now
          </>
        )}
      </button>

      {statusMessage && (
        <div
          className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-md ${
            statusMessage.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}
    </div>
  );
}

