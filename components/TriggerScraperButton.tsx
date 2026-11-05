"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sliders,
  X,
  RefreshCw,
  Clock,
  Database,
  ExternalLink,
} from "lucide-react";

interface TriggerScraperButtonProps {
  onCompleted?: () => void;
  className?: string;
}

export function TriggerScraperButton({ onCompleted, className }: TriggerScraperButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [postLimit, setPostLimit] = useState<number>(10);
  const [activeAccountCount, setActiveAccountCount] = useState<number | null>(null);

  const [errorType, setErrorType] = useState<string | null>(null);

  // Execution states
  const [isStarting, setIsStarting] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<"IDLE" | "STARTING" | "RUNNING" | "INGESTING" | "SUCCEEDED" | "FAILED">("IDLE");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [summaryData, setSummaryData] = useState<{
    postsUpserted?: number;
    snapshotsCreated?: number;
    postsFound?: number;
    accountsCount?: number;
  } | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch count of active accounts when opening modal
  useEffect(() => {
    if (isOpen) {
      fetch("/api/accounts")
        .then((res) => res.json())
        .then((data) => {
          if (data?.accounts) {
            const active = data.accounts.filter((a: { status: string }) => a.status === "active").length;
            setActiveAccountCount(active);
          }
        })
        .catch(() => setActiveAccountCount(null));
    }
  }, [isOpen]);

  // Elapsed timer
  useEffect(() => {
    if (runStatus === "RUNNING" || runStatus === "INGESTING") {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [runStatus]);

  // Poller
  useEffect(() => {
    if (activeRunId && (runStatus === "RUNNING" || runStatus === "INGESTING")) {
      const poll = async () => {
        try {
          const res = await fetch(`/api/apify/status?runId=${activeRunId}`);
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || "Status polling failed");
          }

          if (data.status === "READY" || data.status === "RUNNING") {
            setRunStatus("RUNNING");
            setStatusMessage("Apify worker is actively crawling Instagram profiles & fetching posts...");
          } else if (data.status === "SUCCEEDED") {
            setRunStatus("SUCCEEDED");
            setStatusMessage(data.message || "Scraping & ingestion finished successfully!");
            setSummaryData({
              postsUpserted: data.postsUpserted ?? 0,
              snapshotsCreated: data.snapshotsCreated ?? 0,
              postsFound: data.postsFound ?? 0,
              accountsCount: data.accountsProcessed ?? 0,
            });

            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            router.refresh();
            if (onCompleted) onCompleted();
          } else if (data.status === "FAILED" || data.status === "TIMED-OUT" || data.status === "ABORTED") {
            setRunStatus("FAILED");
            setStatusMessage(data.error || `Crawler ended with status: ${data.status}`);
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          }
        } catch (err: unknown) {
          const errText = err instanceof Error ? err.message : "Error polling run status";
          setStatusMessage(`Polling notice: ${errText}`);
        }
      };

      // Poll immediately, then every 4 seconds
      poll();
      pollIntervalRef.current = setInterval(poll, 4000);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [activeRunId, runStatus, router, onCompleted]);

  const handleStartRun = async () => {
    setIsStarting(true);
    setRunStatus("STARTING");
    setStatusMessage("Querying active accounts and dispatching job to Apify...");
    setElapsedSeconds(0);
    setSummaryData(null);
    setErrorType(null);

    try {
      const res = await fetch("/api/apify/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postLimit }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorType(data.errorType || "UNKNOWN");

        // Build a user-friendly message from structured error response
        const details = data.details as string[] | undefined;
        const errorMsg = details && details.length > 0
          ? details.join("\n")
          : data.error || "Failed to trigger scraper";
        throw new Error(errorMsg);
      }

      setActiveRunId(data.runId);
      setRunStatus("RUNNING");
      setStatusMessage(`Crawler dispatched (Run ID: ${data.runId}). Crawling ${data.accountsCount} accounts...`);
    } catch (err: unknown) {
      setRunStatus("FAILED");
      setStatusMessage(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsStarting(false);
    }
  };

  const handleClose = () => {
    if (runStatus === "RUNNING") {
      // Don't kill background polling, just close modal
      setIsOpen(false);
    } else {
      setIsOpen(false);
      setRunStatus("IDLE");
      setActiveRunId(null);
      setElapsedSeconds(0);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s < 10 ? "0" : ""}${s}s`;
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={
          className ||
          "inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition active:scale-98 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        }
      >
        {runStatus === "RUNNING" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-white" />
            <span>Scraping in progress ({formatSeconds(elapsedSeconds)})</span>
          </>
        ) : (
          <>
            <Play className="h-4 w-4 fill-current" />
            <span>Run Scraper Now</span>
          </>
        )}
      </button>

      {/* Modal Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Play className="h-5 w-5 text-blue-600 fill-current" />
                  Instagram Scraper Launcher
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Execute on-demand crawler directly against active accounts in your database.
                </p>
              </div>
              <button
                onClick={handleClose}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="mt-5 space-y-5">
              {/* Target Accounts Info */}
              <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">Target Accounts</span>
                  <span className="rounded-full bg-blue-100 text-blue-800 px-2.5 py-0.5 text-xs font-semibold">
                    {activeAccountCount !== null ? `${activeAccountCount} active` : "Loading..."}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Pulls all active Instagram handles from your database. Ingestion will automatically update existing posts and daily snapshots.
                </p>
              </div>

              {/* Depth / Post Limit selector (only when idle) */}
              {runStatus === "IDLE" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Posts to fetch per account
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { value: 5, label: "5 Posts", desc: "Fast (Quick refresh)" },
                      { value: 10, label: "10 Posts", desc: "Standard (Recommended)" },
                      { value: 20, label: "20 Posts", desc: "Deep (Historical backfill)" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPostLimit(opt.value)}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition ${
                          postLimit === opt.value
                            ? "border-blue-600 bg-blue-50/50 text-blue-900 ring-2 ring-blue-500"
                            : "border-slate-200 hover:border-slate-300 text-slate-700"
                        }`}
                      >
                        <span className="text-sm font-bold">{opt.label}</span>
                        <span className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Progress & Live Status Box */}
              {runStatus !== "IDLE" && (
                <div
                  className={`rounded-xl border p-4 transition ${
                    runStatus === "SUCCEEDED"
                      ? "bg-emerald-50/60 border-emerald-200"
                      : runStatus === "FAILED"
                      ? "bg-red-50/60 border-red-200"
                      : "bg-blue-50/50 border-blue-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {runStatus === "STARTING" || runStatus === "RUNNING" ? (
                        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                      ) : runStatus === "SUCCEEDED" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-600" />
                      )}
                      <span className="text-sm font-bold text-slate-800">
                        {runStatus === "STARTING" && "Starting Scraper Task..."}
                        {runStatus === "RUNNING" && "Apify Cloud Scraper Running"}
                        {runStatus === "SUCCEEDED" && "Scraping & Ingestion Complete!"}
                        {runStatus === "FAILED" && "Execution Failed"}
                      </span>
                    </div>

                    {(runStatus === "RUNNING" || runStatus === "STARTING") && (
                      <div className="flex items-center gap-1 text-xs text-blue-700 font-mono font-medium">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{formatSeconds(elapsedSeconds)}</span>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 mt-2 leading-relaxed whitespace-pre-line">{statusMessage}</p>

                  {/* Actionable guidance based on error type */}
                  {runStatus === "FAILED" && errorType && (
                    <div className="mt-2 text-[11px] text-red-700/80 bg-red-100/50 rounded-lg px-3 py-2 leading-relaxed">
                      {errorType === "CONFIG" && (
                        <span>
                          <strong>Fix:</strong> Check your <code className="bg-red-200/40 px-1 rounded">.env.local</code> file or go to <strong>Settings → Test Connections</strong> to diagnose.
                        </span>
                      )}
                      {errorType === "AUTH" && (
                        <span>
                          <strong>Fix:</strong> Please log in with your team account to access scraper controls.
                        </span>
                      )}
                      {errorType === "APIFY" && (
                        <span>
                          <strong>Fix:</strong> Review your Apify API token and actor/task configuration in <code className="bg-red-200/40 px-1 rounded">.env.local</code>.
                        </span>
                      )}
                      {errorType === "UNKNOWN" && (
                        <span>Check the browser console and server logs for details.</span>
                      )}
                    </div>
                  )}

                  {/* Summary counts when succeeded */}
                  {summaryData && (
                    <div className="mt-3 grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200/80 text-xs text-emerald-900">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Database className="h-3.5 w-3.5 text-emerald-700" />
                        <span>Posts Upserted: <strong>{summaryData.postsUpserted}</strong></span>
                      </div>
                      <div className="flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                        <span>Daily Snapshots: <strong>{summaryData.snapshotsCreated}</strong></span>
                      </div>
                    </div>
                  )}

                  {activeRunId && (
                    <div className="mt-2 text-[11px] text-slate-400 font-mono">
                      Run ID: {activeRunId}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions Footer */}
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                {runStatus === "SUCCEEDED" ? "Done" : "Close"}
              </button>

              {runStatus === "IDLE" ? (
                <button
                  type="button"
                  onClick={handleStartRun}
                  disabled={isStarting || activeAccountCount === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition disabled:opacity-50"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Launch Scraper
                </button>
              ) : runStatus === "SUCCEEDED" || runStatus === "FAILED" ? (
                <button
                  type="button"
                  onClick={() => {
                    setRunStatus("IDLE");
                    setActiveRunId(null);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition"
                >
                  <RefreshCw className="h-4 w-4" />
                  Run Again
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
