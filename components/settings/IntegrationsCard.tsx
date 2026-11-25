"use client";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plug,
  Sparkles,
  Trash2,
} from "lucide-react";

type ValueSource = "database" | "environment" | "none";
type Platform = "instagram" | "facebook" | "x";

interface IntegrationStatus {
  apifyToken: { configured: boolean; source: ValueSource; masked: string | null };
  taskId: string | null;
  taskSource: ValueSource;
  actors: Record<Platform, { discovery: string; refresh: string }>;
  encryptionKeySource: string;
}

interface SetupResult {
  username: string;
  recognised: string[];
  actions: string[];
  warnings: string[];
  candidates: Array<{ id: string; name: string; title?: string }>;
}

type Notice = { type: "success" | "error"; message: string } | null;

const SOURCE_LABEL: Record<ValueSource, string> = {
  database: "Saved in Settings (encrypted)",
  environment: "From .env / Vercel variable",
  none: "Not set",
};

const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", x: "X" };

function SourceBadge({ source }: { source: ValueSource }) {
  const styles: Record<ValueSource, string> = {
    database: "bg-emerald-50 text-emerald-700 border-emerald-200",
    environment: "bg-blue-50 text-blue-700 border-blue-200",
    none: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${styles[source]}`}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function IntegrationsCard() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [removeTarget, setRemoveTarget] = useState<"apify_api_token" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [actorDraft, setActorDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/integrations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load integrations");
      setStatus(data.status);
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load integrations");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(action);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      if (data.status) setStatus(data.status);
      return data;
    } catch (err: unknown) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Request failed" });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handleSmartSetup = async () => {
    setSetup(null);
    const data = await call("smart-setup", { text: pasted });
    if (data) {
      setSetup(data);
      setPasted(""); // never keep a pasted secret in the page longer than needed
      setNotice({ type: "success", message: `Connected to Apify as @${data.username}.` });
    }
  };

  const handleSelectTask = async (taskId: string) => {
    const data = await call("select-task", { taskId });
    if (data) {
      setSetup((prev) => (prev ? { ...prev, candidates: [] } : prev));
      setNotice({ type: "success", message: "Task selected." });
    }
  };

  const handleRemove = (name: "apify_api_token") => setRemoveTarget(name);

  const confirmRemove = async () => {
    const name = removeTarget;
    setRemoveTarget(null);
    if (!name) return;
    const data = await call("remove-secret", { name });
    if (data) setNotice({ type: "success", message: "Credential removed." });
  };

  const handleSaveActors = async (platform: Platform) => {
    const discovery = actorDraft[`${platform}:discovery`]?.trim();
    const refresh = actorDraft[`${platform}:refresh`]?.trim();
    if (!discovery && !refresh) return;
    const data = await call("save-actors", { platform, ...(discovery ? { discovery } : {}), ...(refresh ? { refresh } : {}) });
    if (data) {
      setActorDraft((d) => ({ ...d, [`${platform}:discovery`]: "", [`${platform}:refresh`]: "" }));
      setNotice({ type: "success", message: `${PLATFORM_LABEL[platform]} actor IDs saved.` });
    }
  };

  const allGood = !!status?.apifyToken.configured;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Plug className="h-5 w-5 text-violet-600" />
            Apify connection
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Paste your token (or a whole .env snippet / Apify link). Saikil Shakti detects what it needs, tests it against Apify, and stores it encrypted - no code or redeploy needed.
          </p>
        </div>
        <span
          className={`px-2.5 py-1 text-xs font-semibold rounded-full border self-start ${
            allGood ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
          }`}
        >
          {allGood ? "Connected" : "Not connected"}
        </span>
      </div>

      {loadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Smart paste */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-violet-600" />
          Smart setup - paste anything
        </label>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder={"apify_api_xxxxxxxx…   or   APIFY_API_TOKEN=…   or   https://console.apify.com/actors/tasks/…"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-violet-500 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Your text is parsed on the server only and is never sent to an AI model or any third party except Apify itself (to verify the token).
          </span>
          <button
            type="button"
            onClick={handleSmartSetup}
            disabled={!pasted.trim() || busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-violet-700 transition disabled:opacity-50 shrink-0"
          >
            {busy === "smart-setup" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Detect &amp; Connect
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
            notice.type === "success"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {notice.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      {setup && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
          {setup.actions.map((a) => (
            <div key={a} className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> {a}
            </div>
          ))}
          {setup.warnings.map((w) => (
            <div key={w} className="flex items-start gap-1.5 text-amber-700">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}
            </div>
          ))}
          {setup.candidates.length > 1 && (
            <div className="pt-1">
              <label className="block text-slate-600 font-semibold mb-1">Which task runs your Instagram scrape?</label>
              <select
                defaultValue=""
                onChange={(e) => e.target.value && handleSelectTask(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="">Choose a task…</option>
                {setup.candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title || t.name} ({t.id})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Current status */}
      {status && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Apify API token</span>
              {status.apifyToken.source === "database" && (
                <button onClick={() => handleRemove("apify_api_token")} title="Remove saved token" className="text-slate-500 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="text-xs font-mono text-slate-600">{status.apifyToken.masked ?? "-"}</div>
            <SourceBadge source={status.apifyToken.source} />
          </div>
          <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">Instagram Task</span>
            <div className="text-xs font-mono text-slate-600 break-all">{status.taskId ?? "none (calls actor directly)"}</div>
            <SourceBadge source={status.taskSource} />
          </div>
        </div>
      )}

      {/* Advanced actors */}
      {status && (
        <details className="rounded-lg border border-slate-200 p-4 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700">Advanced: Apify Actor IDs per platform</summary>
          <div className="mt-3 space-y-3">
            {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
              <div key={p} className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr_auto] gap-2 items-center">
                <span className="font-semibold text-slate-700">{PLATFORM_LABEL[p]}</span>
                <input
                  value={actorDraft[`${p}:discovery`] ?? ""}
                  onChange={(e) => setActorDraft((d) => ({ ...d, [`${p}:discovery`]: e.target.value }))}
                  placeholder={`discovery: ${status.actors[p].discovery}`}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 font-mono"
                />
                <input
                  value={actorDraft[`${p}:refresh`] ?? ""}
                  onChange={(e) => setActorDraft((d) => ({ ...d, [`${p}:refresh`]: e.target.value }))}
                  placeholder={`refresh: ${status.actors[p].refresh}`}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 font-mono"
                />
                <button
                  onClick={() => handleSaveActors(p)}
                  disabled={busy !== null}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {status && (
        <p className="text-xs text-slate-500">
          Credentials are encrypted with AES-256-GCM using {status.encryptionKeySource}. Set a dedicated <span className="font-mono">SETTINGS_ENCRYPTION_KEY</span> in Vercel to rotate it independently.
        </p>
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove saved credential?"
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        The saved Apify token will be deleted. If the same value exists as an environment variable, the app falls back to that; otherwise collection stops working until you add a new one.
      </ConfirmDialog>
    </div>
  );
}
