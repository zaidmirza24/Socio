"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Coins, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import type { UsageReport } from "@/lib/services/apify-usage";

const usd = (n: number | null | undefined, dp?: number): string => {
  if (n === null || n === undefined) return "n/a";
  const digits = dp ?? (Math.abs(n) < 1 ? 3 : 2);
  return `$${n.toFixed(digits)}`;
};

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X" };
const JOB_LABEL: Record<string, string> = { discovery: "Daily discovery", refresh: "Weekly refresh", direct_url: "Single-post lookups" };

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${color}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function BarList({ rows }: { rows: Array<{ label: string; usd: number; sub?: string }> }) {
  const max = Math.max(...rows.map((r) => r.usd), 0.000001);
  if (rows.length === 0) return <div className="text-xs text-slate-500">No cost recorded yet.</div>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-xs">
            <span className="text-slate-700">{r.label}</span>
            <span className="font-mono text-slate-900">
              {usd(r.usd)} {r.sub && <span className="text-slate-500">· {r.sub}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 mt-1">
            <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (r.usd / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ApifyUsageCard() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [thresholdInput, setThresholdInput] = useState("80");
  const [savingBudget, setSavingBudget] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/usage");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load usage");
      const r: UsageReport = data.report;
      setReport(r);
      setBudgetInput(r.summary.budget.monthlyUsd ? String(r.summary.budget.monthlyUsd) : "");
      setThresholdInput(String(r.summary.budget.alertThresholdPct));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const data = await post({ action: "sync" });
      setReport(data.report);
      setSyncMsg(data.message);
    } catch (err: unknown) {
      setSyncMsg(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBudget(true);
    try {
      const monthlyUsd = budgetInput.trim() === "" ? null : Number(budgetInput);
      if (monthlyUsd !== null && (!Number.isFinite(monthlyUsd) || monthlyUsd <= 0)) throw new Error("Enter a positive dollar amount, or leave blank for no budget.");
      const data = await post({ action: "set-budget", monthlyUsd, alertThresholdPct: Number(thresholdInput) || 80 });
      setReport(data.report);
      setSyncMsg("Budget saved.");
    } catch (err: unknown) {
      setSyncMsg(err instanceof Error ? err.message : "Could not save budget");
    } finally {
      setSavingBudget(false);
    }
  };

  const s = report?.summary;
  const acct = report?.apifyAccount;
  const maxDaily = s ? Math.max(...s.daily.map((d) => d.usd), 0.000001) : 1;
  const budgetTone = s?.budget.status === "over" ? "bad" : s?.budget.status === "warning" ? "warn" : undefined;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-600" />
            Apify usage and cost
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Real cost of every scrape this platform started, pulled from Apify after each run. Billing cycle starts {s?.cycleStart ?? "…"}.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 self-start"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync costs from Apify{s && s.runsPendingCost > 0 ? ` (${s.runsPendingCost} pending)` : ""}
        </button>
      </div>

      {loading && !report && (
        <div className="py-6 flex items-center justify-center gap-2 text-slate-500 text-xs">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading usage…
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {syncMsg && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-blue-600" /> {syncMsg}
        </div>
      )}

      {report && s && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Spent this billing cycle" value={usd(s.spentUsd)} hint={`${s.runs} run(s) · day ${s.daysElapsed} of ${s.daysInCycle}`} />
            <Tile
              label="Projected for the cycle"
              value={usd(s.projectedUsd, 2)}
              hint={s.projectedUsd === null ? "needs 3+ days of data" : "based on daily average"}
            />
            <Tile
              label="Monthly budget used"
              value={s.budget.usedPct === null ? "no budget" : `${s.budget.usedPct}%`}
              hint={s.budget.monthlyUsd ? `of ${usd(s.budget.monthlyUsd, 2)}` : "set one below"}
              tone={budgetTone}
            />
            <Tile
              label="Cost per stored post"
              value={usd(s.costPerStoredPostUsd, 4)}
              hint={s.costPerItemUsd !== null ? `${usd(s.costPerItemUsd, 4)} per item scraped` : "no measured runs yet"}
            />
          </div>

          {s.budget.status === "warning" || s.budget.status === "over" ? (
            <div className={`rounded-lg p-3 text-xs flex items-center gap-2 border ${s.budget.status === "over" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
              <AlertCircle className="h-4 w-4 shrink-0" />
              {s.budget.status === "over"
                ? "You have gone over your monthly Apify budget. Consider the 30-day window strategy or fewer posts per account."
                : `You have used ${s.budget.usedPct}% of your monthly Apify budget.`}
            </div>
          ) : null}

          {/* Apify account comparison */}
          <div className="rounded-lg border border-slate-200 p-4 text-xs space-y-1.5">
            <div className="font-bold text-slate-900 text-sm">Your Apify account</div>
            {acct?.available ? (
              <>
                <div className="text-slate-700">
                  Account usage this cycle: <span className="font-mono font-semibold">{usd(acct.monthlyUsageUsd, 2)}</span>
                  {acct.maxMonthlyUsageUsd ? <> of <span className="font-mono">{usd(acct.maxMonthlyUsageUsd, 2)}</span> plan limit</> : null}
                </div>
                <div className="text-slate-700">
                  Saikil Shakti&apos;s share: <span className="font-mono font-semibold">{acct.socioSharePct ?? 0}%</span>
                  {" · "}Not logged by Saikil Shakti: <span className="font-mono">{usd(acct.untrackedUsd, 2)}</span>
                  <span className="text-slate-500"> (manual runs, other projects, storage)</span>
                </div>
              </>
            ) : (
              <div className="text-slate-500">{acct?.error ?? "Connect Apify above to compare with your account's real usage."}</div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">By platform</div>
              <BarList rows={s.byPlatform.map((p) => ({ label: PLATFORM_LABEL[p.platform] ?? p.platform, usd: p.usd, sub: `${p.runs} runs` }))} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">By job type</div>
              <BarList rows={s.byJobType.map((j) => ({ label: JOB_LABEL[j.jobType] ?? j.jobType, usd: j.usd, sub: `${j.runs} runs` }))} />
            </div>
          </div>

          {/* Daily bars */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Last 30 days · {usd(s.last30DaysUsd)}
            </div>
            <div className="flex items-end gap-[3px] h-20" role="img" aria-label="Daily Apify cost for the last 30 days">
              {s.daily.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${usd(d.usd)} (${d.runs} runs)`}
                  className={`flex-1 rounded-t ${d.usd > 0 ? "bg-indigo-500" : "bg-slate-200"}`}
                  style={{ height: `${d.usd > 0 ? Math.max(6, (d.usd / maxDaily) * 100) : 4}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>{s.daily[0]?.date}</span>
              <span>{s.daily[s.daily.length - 1]?.date}</span>
            </div>
          </div>

          {/* Forecast */}
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Forecast at your current settings: ~{usd(report.estimate.totalUsd, 2)} / month
            </div>
            <div className="text-slate-700">
              Daily discovery: {report.estimate.activeAccounts} accounts × limit → ~{report.estimate.discoveryItemsPerMonth.toLocaleString()} items ({usd(report.estimate.discoveryUsd, 2)}) ·
              Refresh: {report.estimate.trackedPosts} tracked posts → ~{report.estimate.refreshItemsPerMonth.toLocaleString()} items ({usd(report.estimate.refreshUsd, 2)})
            </div>
            <div className="text-slate-500">
              Uses {usd(report.estimate.costPerItemUsd, 4)} per item (
              {report.estimate.basis === "measured" ? "measured from your real runs" : "an assumed default until your first costed run - treat as a rough guide"}
              ). Change the refresh strategy above and this updates.
            </div>
          </div>

          {/* Budget form */}
          <form onSubmit={handleSaveBudget} className="flex flex-col sm:flex-row sm:items-end gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Monthly budget (USD)</label>
              <input
                type="number"
                min={1}
                step="0.5"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="e.g. 30"
                className="w-full sm:w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Warn at (% used)</label>
              <input
                type="number"
                min={1}
                max={100}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                className="w-full sm:w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={savingBudget}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingBudget && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save budget
            </button>
          </form>
        </>
      )}
    </div>
  );
}
