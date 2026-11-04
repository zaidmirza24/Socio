import { ShieldCheck, CheckCircle2, AlertCircle, Clock, Server } from "lucide-react";
import { TriggerScraperButton } from "@/components/TriggerScraperButton";

const sampleRuns = [
  {
    id: "run-20261104-01",
    actorRunId: "act_IG_20261104_023000",
    platform: "instagram",
    startedAt: "2026-11-04T02:30:00Z",
    completedAt: "2026-11-04T02:32:15Z",
    duration: "2m 15s",
    status: "success",
    accountsTargeted: 30,
    postsFound: 286,
    postsUpserted: 286,
    snapshotsCreated: 286,
  },
  {
    id: "run-20261103-01",
    actorRunId: "act_IG_20261103_023000",
    platform: "instagram",
    startedAt: "2026-11-03T02:30:00Z",
    completedAt: "2026-11-03T02:31:50Z",
    duration: "1m 50s",
    status: "success",
    accountsTargeted: 30,
    postsFound: 282,
    postsUpserted: 282,
    snapshotsCreated: 282,
  },
];

export default function SystemHealthPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            System Health & Automation Logs
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time status of Apify daily scheduled scraping and webhook ingestion pipeline.
          </p>
        </div>
        <TriggerScraperButton />
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Apify Schedule</span>
            <Clock className="h-5 w-5 text-blue-600" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-slate-900">8:00 AM IST</span>
            <span className="block text-xs text-slate-500 mt-0.5">02:30 UTC Daily Trigger</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <CheckCircle2 className="h-4 w-4" /> Active on Apify Cloud
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Webhook Receiver</span>
            <Server className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-slate-900">/api/webhooks/apify</span>
            <span className="block text-xs text-slate-500 mt-0.5">Vercel Serverless Edge</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <ShieldCheck className="h-4 w-4" /> Secret Verification Enabled
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Database Upserts</span>
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-slate-900">100% Idempotent</span>
            <span className="block text-xs text-slate-500 mt-0.5">ON CONFLICT Unique Guard</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <CheckCircle2 className="h-4 w-4" /> Zero duplicate rows
          </div>
        </div>
      </div>

      {/* Collection Runs Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Recent Collection Runs (`collection_runs`)</h2>
          <span className="text-xs text-slate-400">Audit logs for scrape and ingestion events</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Run ID</th>
                <th className="px-6 py-3">Apify Actor Run</th>
                <th className="px-6 py-3">Execution Time</th>
                <th className="px-6 py-3">Duration</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Accounts</th>
                <th className="px-6 py-3 text-right">Posts Upserted</th>
                <th className="px-6 py-3 text-right">Snapshots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sampleRuns.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50 transition">
                  <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-900">{run.id}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{run.actorRunId}</td>
                  <td className="px-6 py-4 text-xs">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-6 py-4 text-xs font-medium text-slate-700">{run.duration}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" /> {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-medium">{run.accountsTargeted}</td>
                  <td className="px-6 py-4 text-right font-medium">{run.postsUpserted}</td>
                  <td className="px-6 py-4 text-right font-medium text-blue-600">{run.snapshotsCreated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

