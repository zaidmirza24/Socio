"use client";

import { useState } from "react";
import {
  Settings,
  Database,
  Cloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  KeyRound,
  Shield,
  HelpCircle,
} from "lucide-react";

interface TestResult {
  success: boolean;
  results: {
    supabase: { ok: boolean; message: string; accountCount?: number };
    apify: { ok: boolean; message: string; username?: string };
  };
  env: {
    supabaseUrlConfigured: boolean;
    apifyTokenConfigured: boolean;
    apifyTaskIdConfigured: boolean;
  };
}

export default function SettingsPage() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const handleTestConnections = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/test-connection");
      const data = await res.json();
      setTestResult(data);
    } catch (e: unknown) {
      setTestResult({
        success: false,
        results: {
          supabase: { ok: false, message: "Network error reaching test endpoint" },
          apify: { ok: false, message: "Network error reaching test endpoint" },
        },
        env: {
          supabaseUrlConfigured: false,
          apifyTokenConfigured: false,
          apifyTaskIdConfigured: false,
        },
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Settings className="h-6 w-6 text-blue-600" />
          Platform Settings & Diagnostics
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Verify connected services, Apify scraper credentials, and Supabase database status.
        </p>
      </div>

      {/* Connectivity Check Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Shield className="h-5 w-5 text-emerald-600" />
              Service Connectivity Diagnostics
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Verify live API connectivity with Supabase PostgreSQL and Apify Cloud.
            </p>
          </div>
          <button
            onClick={handleTestConnections}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800 transition disabled:opacity-50"
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing APIs...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Test Connections
              </>
            )}
          </button>
        </div>

        {testResult && (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Supabase Status */}
            <div
              className={`rounded-xl border p-4 ${
                testResult.results.supabase.ok
                  ? "bg-emerald-50/60 border-emerald-200"
                  : "bg-red-50/60 border-red-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold flex items-center gap-2 text-slate-900">
                  <Database className="h-4 w-4 text-emerald-600" />
                  Supabase PostgreSQL
                </span>
                {testResult.results.supabase.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                )}
              </div>
              <p className="text-xs text-slate-600 mt-2">{testResult.results.supabase.message}</p>
              {testResult.results.supabase.accountCount !== undefined && (
                <div className="text-[11px] text-slate-500 mt-1 font-mono">
                  Accounts in database: {testResult.results.supabase.accountCount}
                </div>
              )}
            </div>

            {/* Apify Status */}
            <div
              className={`rounded-xl border p-4 ${
                testResult.results.apify.ok
                  ? "bg-emerald-50/60 border-emerald-200"
                  : "bg-red-50/60 border-red-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold flex items-center gap-2 text-slate-900">
                  <Cloud className="h-4 w-4 text-blue-600" />
                  Apify Cloud API
                </span>
                {testResult.results.apify.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                )}
              </div>
              <p className="text-xs text-slate-600 mt-2">{testResult.results.apify.message}</p>
              {testResult.results.apify.username && (
                <div className="text-[11px] text-slate-500 mt-1 font-mono">
                  Apify Account: @{testResult.results.apify.username}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Environment Configuration Guide */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-slate-700" />
          Environment & Security Overview
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          Sensitive API keys (such as <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">SUPABASE_SERVICE_ROLE_KEY</code> and <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">APIFY_API_TOKEN</code>) are secured on the server via <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env.local</code> and Vercel Environment Variables. They are never exposed to the client bundle.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-3 rounded-lg border border-slate-100 bg-slate-50">
            <span className="text-xs font-semibold text-slate-500">APIFY_API_TOKEN</span>
            <div className="text-xs font-mono text-slate-700 mt-1">Configured on Server</div>
          </div>
          <div className="p-3 rounded-lg border border-slate-100 bg-slate-50">
            <span className="text-xs font-semibold text-slate-500">APIFY_TASK_ID / ACTOR_ID</span>
            <div className="text-xs font-mono text-slate-700 mt-1">Configured on Server</div>
          </div>
          <div className="p-3 rounded-lg border border-slate-100 bg-slate-50">
            <span className="text-xs font-semibold text-slate-500">SUPABASE_SERVICE_ROLE</span>
            <div className="text-xs font-mono text-slate-700 mt-1">Configured on Server</div>
          </div>
        </div>
      </div>
    </div>
  );
}

