"use client";

import { useState, useEffect, useCallback } from "react";
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
  Users,
  UserPlus,
  Trash2,
  Lock,
  Mail,
  User,
  Clock,
  Sliders,
  Sparkles,
  Zap,
} from "lucide-react";
import { formatDisplayDate } from "@/lib/utils";
import { IntegrationsCard } from "@/components/settings/IntegrationsCard";
import { ApifyUsageCard } from "@/components/settings/ApifyUsageCard";
import { setFeatureFlags } from "@/hooks/useFeatureSettings";

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

interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "member";
  created_at: string;
}

export default function SettingsPage() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Current user info
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    email: string;
    role: string;
    full_name: string | null;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);

  // Team users list (Admin only)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);

  // New user form state
  const [newUserFullName, setNewUserFullName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "member">("member");
  const [submittingUser, setSubmittingUser] = useState(false);
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [userFormSuccess, setUserFormSuccess] = useState<string | null>(null);

  // Scraper Refresh Strategy state (Default: 30-day cutoff, 7-day interval)
  const [strategy, setStrategy] = useState<{
    mode: "30_day_cutoff" | "continuous";
    refresh_interval_days: number;
    cutoff_days: number;
    discovery_post_limit: number;
  }>({
    mode: "30_day_cutoff",
    refresh_interval_days: 7,
    cutoff_days: 30,
    discovery_post_limit: 10,
  });
  const [strategyStats, setStrategyStats] = useState<{
    totalTrackedPosts: number;
    eligibleForRefresh: number;
  } | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [strategyNotice, setStrategyNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [triggeringRefresh, setTriggeringRefresh] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  // Multi-platform enablement state (Default: Instagram active, Facebook/X disabled)
  const [platformSettings, setPlatformSettings] = useState<{
    instagram: { enabled: boolean };
    facebook: { enabled: boolean };
    x: { enabled: boolean };
  }>({
    instagram: { enabled: true },
    facebook: { enabled: false },
    x: { enabled: false },
  });
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [platformNotice, setPlatformNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Feature toggles (Campaign Captions on/off)
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [savingFeature, setSavingFeature] = useState(false);
  const [featureNotice, setFeatureNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleToggleCaptions = async (enabled: boolean) => {
    setSavingFeature(true);
    setFeatureNotice(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { campaign_captions_enabled: enabled } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update feature setting");
      const next = Boolean(data.featureSettings?.campaign_captions_enabled);
      setCaptionsEnabled(next);
      setFeatureFlags({ campaign_captions_enabled: next });
      setFeatureNotice({
        type: "success",
        message: `Campaign Captions has been turned ${next ? "on" : "off"}.`,
      });
    } catch (err: unknown) {
      setFeatureNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Error updating feature setting",
      });
    } finally {
      setSavingFeature(false);
    }
  };

  const fetchStrategy = useCallback(async () => {
    setLoadingStrategy(true);
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.strategy) setStrategy(data.strategy);
        if (data.platformSettings) setPlatformSettings(data.platformSettings);
        if (data.featureSettings) setCaptionsEnabled(data.featureSettings.campaign_captions_enabled);
        if (data.stats) setStrategyStats(data.stats);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingStrategy(false);
    }
  }, []);

  const handleTogglePlatform = async (platformKey: "instagram" | "facebook" | "x", newEnabled: boolean) => {
    if (platformKey === "instagram" && !newEnabled) {
      alert("Instagram is the primary baseline monitoring platform and cannot be disabled.");
      return;
    }
    setSavingPlatform(true);
    setPlatformNotice(null);
    const updated = {
      ...platformSettings,
      [platformKey]: { enabled: newEnabled },
    };
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: updated }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update platform settings");
      if (data.platformSettings) setPlatformSettings(data.platformSettings);
      const name = platformKey === "facebook" ? "Facebook" : "Twitter / X";
      setPlatformNotice({
        type: "success",
        message: `${name} monitoring has been ${newEnabled ? "enabled" : "disabled"} successfully!`,
      });
    } catch (err: unknown) {
      setPlatformNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Error updating platform setting",
      });
    } finally {
      setSavingPlatform(false);
    }
  };

  const handleSaveStrategy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingStrategy(true);
    setStrategyNotice(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strategy),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update strategy");
      setStrategy(data.strategy);
      if (data.stats) setStrategyStats(data.stats);
      setStrategyNotice({ type: "success", message: "Scraper refresh strategy updated successfully!" });
    } catch (err: unknown) {
      setStrategyNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Error saving strategy",
      });
    } finally {
      setSavingStrategy(false);
    }
  };

  const handleTriggerRefreshNow = async () => {
    setTriggeringRefresh(true);
    setRefreshMessage(null);
    try {
      const res = await fetch("/api/scraper/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "refresh" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to trigger refresh run");
      setRefreshMessage(data.message || `Dispatched refresh for ${data.eligiblePostsCount || 0} posts.`);
      fetchStrategy();
    } catch (err: unknown) {
      setRefreshMessage(err instanceof Error ? err.message : "Error starting refresh job");
    } finally {
      setTriggeringRefresh(false);
    }
  };

  const fetchTeamMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data.users || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // Fetch current user and role
  const fetchCurrentUser = useCallback(async () => {
    setLoadingUser(true);
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setCurrentUser({
            id: data.user.id,
            email: data.user.email,
            role: data.profile?.role || "member",
            full_name: data.profile?.full_name || null,
          });
          setIsAdmin(data.isAdmin);

          // Load strategy
          fetchStrategy();

          // If admin, load team members
          if (data.isAdmin) {
            fetchTeamMembers();
          }
        }
      }
    } catch {
      // Ignored
    } finally {
      setLoadingUser(false);
    }
  }, [fetchTeamMembers, fetchStrategy]);

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const handleTestConnections = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/test-connection");
      const data = await res.json();
      setTestResult(data);
    } catch {
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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingUser(true);
    setUserFormError(null);
    setUserFormSuccess(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: newUserFullName,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create user");
      }

      setUserFormSuccess(`User ${newUserEmail} registered as ${newUserRole}!`);
      setNewUserFullName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("member");
      setIsAddUserModalOpen(false);
      fetchTeamMembers();
    } catch (err: unknown) {
      setUserFormError(err instanceof Error ? err.message : "Error creating user");
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Are you sure you want to remove ${email} from the team?`)) {
      return;
    }

    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete user");
      } else {
        fetchTeamMembers();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Settings className="h-6 w-6 text-blue-600" />
          Platform Settings & Team Access
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Manage team members, verify connected services, and inspect system credentials.
        </p>
      </div>

      {/* User Session & Role Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
              {currentUser?.email ? currentUser.email[0].toUpperCase() : "U"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {currentUser?.full_name || currentUser?.email || "Authenticated User"}
                </span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                    isAdmin
                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                      : "bg-slate-100 text-slate-700 border border-slate-200"
                  }`}
                >
                  {isAdmin ? "Admin" : "Standard Member"}
                </span>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {currentUser?.email}
              </span>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            {isAdmin
              ? "Full privileges: Can manage accounts, trigger scrapes, and add team members."
              : "Standard privileges: Read-only access to team management."}
          </div>
        </div>
      </div>

      {/* Apify connection: paste token, auto-detect task, register webhook (admin only) */}
      {isAdmin && <IntegrationsCard />}

      {/* Feature Toggles */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Campaign Captions</h3>
            <p className="text-xs text-slate-500 mt-1">
              <strong>On:</strong> new posts are filtered by your campaign captions (only matches are
              kept). Posts already captured while Off keep refreshing.
              <br />
              <strong>Off:</strong> every post from monitored accounts is captured and refreshed,
              matching or not (see Recent Posts), and the Captions page is hidden. Nothing is ever
              deleted when you switch.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={captionsEnabled}
            disabled={!isAdmin || savingFeature}
            onClick={() => handleToggleCaptions(!captionsEnabled)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
              captionsEnabled ? "bg-blue-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                captionsEnabled ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        {featureNotice && (
          <div
            className={`mt-4 rounded-lg p-3 text-xs ${
              featureNotice.type === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}
          >
            {featureNotice.message}
          </div>
        )}
        {!isAdmin && (
          <p className="mt-3 text-[11px] text-slate-500">Only administrators can change this.</p>
        )}
      </div>

      {/* Scraper Refresh Strategy & Cost Optimization Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="h-5 w-5 text-indigo-600" />
              Scraper Refresh Strategy & Cost Optimization
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Select between a 30-day cost-optimized window or continuous lifetime post tracking.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                strategy.mode === "30_day_cutoff"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-blue-50 text-blue-700 border-blue-200"
              }`}
            >
              Active: {strategy.mode === "30_day_cutoff" ? "30-Day Window (Cost Saver)" : "Continuous Tracking"}
            </span>
          </div>
        </div>

        {/* Live Eligibility Statistics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 text-xs">
          <div>
            <span className="text-slate-500 font-medium">Total Tracked Posts:</span>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {strategyStats ? strategyStats.totalTrackedPosts : "Loading..."}
            </div>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Eligible For {strategy.refresh_interval_days}-Day Refresh:</span>
            <div className="text-sm font-bold text-indigo-700 mt-0.5">
              {strategyStats ? `${strategyStats.eligibleForRefresh} posts due` : "Loading..."}
            </div>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Active Mode:</span>
            <div className="text-sm font-bold text-slate-800 mt-0.5">
              {strategy.mode === "30_day_cutoff" ? `${strategy.cutoff_days}-Day Cutoff` : "Continuous Tracking"}
            </div>
          </div>
        </div>

        {/* Strategy Mode Selector */}
        <form onSubmit={handleSaveStrategy} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Select Refresh Strategy
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Option 1: 30-Day Cutoff Window (Default) */}
              <div
                onClick={() => isAdmin && setStrategy((prev) => ({ ...prev, mode: "30_day_cutoff" }))}
                className={`cursor-pointer rounded-xl border p-4 transition ${
                  strategy.mode === "30_day_cutoff"
                    ? "border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-400"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                    30-Day Window (Default)
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                    High Cost Savings
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Refreshes posts every 7 days during their first 30 days (~4–5 refreshes per post). Older posts are automatically frozen to minimize third-party scraping bills.
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Recommended for regular volunteer campaign tracking</span>
                </div>
              </div>

              {/* Option 2: Continuous Tracking */}
              <div
                onClick={() => isAdmin && setStrategy((prev) => ({ ...prev, mode: "continuous" }))}
                className={`cursor-pointer rounded-xl border p-4 transition ${
                  strategy.mode === "continuous"
                    ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-400"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-600" />
                    Continuous Lifetime
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                    Full History
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Refreshes all active posts every 7 days continuously without any age cutoff (~21–22 refreshes per post over 5 months).
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-blue-700 font-medium">
                  <Zap className="h-3.5 w-3.5" />
                  <span>Tracks viral/long-term engagement growth over months</span>
                </div>
              </div>
            </div>
          </div>

          {/* Configuration Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Refresh Interval (Days)
              </label>
              <input
                type="number"
                min={1}
                max={90}
                disabled={!isAdmin}
                value={strategy.refresh_interval_days}
                onChange={(e) =>
                  setStrategy((prev) => ({
                    ...prev,
                    refresh_interval_days: parseInt(e.target.value, 10) || 7,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500">Days between metric refreshes (Default: 7)</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Active Cutoff (Days)
              </label>
              <input
                type="number"
                min={7}
                max={365}
                disabled={!isAdmin || strategy.mode !== "30_day_cutoff"}
                value={strategy.cutoff_days}
                onChange={(e) =>
                  setStrategy((prev) => ({
                    ...prev,
                    cutoff_days: parseInt(e.target.value, 10) || 30,
                  }))
                }
                className={`w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none ${
                  strategy.mode !== "30_day_cutoff" ? "bg-slate-100 text-slate-400" : ""
                }`}
              />
              <span className="text-[10px] text-slate-500">Freeze age in Cutoff mode (Default: 30)</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Discovery Post Limit
              </label>
              <input
                type="number"
                min={1}
                max={50}
                disabled={!isAdmin}
                value={strategy.discovery_post_limit}
                onChange={(e) =>
                  setStrategy((prev) => ({
                    ...prev,
                    discovery_post_limit: parseInt(e.target.value, 10) || 10,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500">Recent posts per account in daily crawl</span>
            </div>
          </div>

          {/* Strategy Save Notice */}
          {strategyNotice && (
            <div
              className={`rounded-lg p-3 text-xs flex items-center gap-2 ${
                strategyNotice.type === "success"
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
            >
              {strategyNotice.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-600" />
              )}
              <span>{strategyNotice.message}</span>
            </div>
          )}

          {refreshMessage && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <span>{refreshMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          {isAdmin && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleTriggerRefreshNow}
                disabled={triggeringRefresh || (strategyStats?.eligibleForRefresh === 0)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50/70 px-4 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 transition disabled:opacity-50"
              >
                {triggeringRefresh ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Dispatching Refresh...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh Eligible Posts Now ({strategyStats?.eligibleForRefresh || 0})
                  </>
                )}
              </button>

              <button
                type="submit"
                disabled={savingStrategy}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {savingStrategy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save Refresh Strategy
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Apify credit usage, budget and forecast (admin only) */}
      {isAdmin && <ApifyUsageCard />}

      {/* Multi-Platform Scraping Integration Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="h-5 w-5 text-indigo-600" />
                Multi-Platform Social Media Monitoring
              </h3>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
                Instagram • Facebook • Twitter/X
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Enable or disable data ingestion independently across social networks. Facebook and Twitter/X are safely isolated and do not disrupt Instagram.
            </p>
          </div>
        </div>

        {platformNotice && (
          <div
            className={`mt-4 rounded-lg p-3 text-xs flex items-center gap-2 ${
              platformNotice.type === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}
          >
            {platformNotice.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600" />
            )}
            <span>{platformNotice.message}</span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Instagram */}
          <div className="rounded-xl border border-pink-200 bg-pink-50/30 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-pink-500 animate-pulse"></span>
                  Instagram
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  Primary • Active
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Monitors volunteer Instagram posts, reels, video views, and likes. Discovery &amp; 7-day refresh fully enabled.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-pink-100 text-[11px] text-slate-500 flex justify-between items-center">
              <span>Status</span>
              <span className="font-semibold text-emerald-600">Always Enabled</span>
            </div>
          </div>

          {/* Facebook */}
          <div className={`rounded-xl border p-4 flex flex-col justify-between transition ${
            platformSettings.facebook?.enabled
              ? "border-blue-300 bg-blue-50/30"
              : "border-slate-200 bg-slate-50/50"
          }`}>
            <div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${platformSettings.facebook?.enabled ? "bg-blue-600" : "bg-slate-300"}`}></span>
                  Facebook
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  platformSettings.facebook?.enabled
                    ? "text-blue-700 bg-blue-100"
                    : "text-slate-600 bg-slate-200"
                }`}>
                  {platformSettings.facebook?.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Tracks public volunteer page &amp; profile posts, reactions, comments, and shares.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Toggle Access</span>
              <button
                type="button"
                disabled={!isAdmin || savingPlatform}
                onClick={() => handleTogglePlatform("facebook", !platformSettings.facebook?.enabled)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                  platformSettings.facebook?.enabled ? "bg-blue-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    platformSettings.facebook?.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Twitter / X */}
          <div className={`rounded-xl border p-4 flex flex-col justify-between transition ${
            platformSettings.x?.enabled
              ? "border-neutral-300 bg-neutral-50/60"
              : "border-slate-200 bg-slate-50/50"
          }`}>
            <div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${platformSettings.x?.enabled ? "bg-black" : "bg-slate-300"}`}></span>
                  Twitter / X
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  platformSettings.x?.enabled
                    ? "text-slate-900 bg-slate-200"
                    : "text-slate-600 bg-slate-200"
                }`}>
                  {platformSettings.x?.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Extracts volunteer tweets, retweets, replies, likes, and full post view impressions.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-200/60 flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Toggle Access</span>
              <button
                type="button"
                disabled={!isAdmin || savingPlatform}
                onClick={() => handleTogglePlatform("x", !platformSettings.x?.enabled)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                  platformSettings.x?.enabled ? "bg-black" : "bg-slate-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    platformSettings.x?.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Team Access & Sign-Up Management Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              Team Access & User Management
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Role-based access control. Only Admins can register or invite new team users.
            </p>
          </div>

          {/* Sign Up / Add Member Button: ONLY visible to ADMIN */}
          {isAdmin ? (
            <button
              onClick={() => {
                setUserFormError(null);
                setUserFormSuccess(null);
                setIsAddUserModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition"
            >
              <UserPlus className="h-4 w-4" />
              Sign Up Team Member
            </button>
          ) : (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs text-slate-600 font-medium">
              User signup restricted to Administrators
            </div>
          )}
        </div>

        {/* Member list for Admin */}
        {isAdmin ? (
          <div className="mt-5">
            {loadingMembers ? (
              <div className="py-6 flex items-center justify-center text-slate-400 gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="text-xs">Loading team members...</span>
              </div>
            ) : teamMembers.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No additional team members found. Click &quot;Sign Up Team Member&quot; to add one.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-600">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">Name & Email</th>
                      <th className="px-4 py-2.5">Role</th>
                      <th className="px-4 py-2.5">Added Date</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {teamMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 text-xs">
                            {member.full_name || "Team Member"}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {member.email}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                              member.role === "admin"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {member.role}
                          </span>
                        </td>
                        <td suppressHydrationWarning className="px-4 py-3 text-xs text-slate-500">
                          {formatDisplayDate(member.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {member.id !== currentUser?.id && (
                            <button
                              onClick={() => handleDeleteUser(member.id, member.email)}
                              className="text-slate-400 hover:text-red-600 p-1 transition"
                              title="Delete user"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
            You are signed in as a <span className="font-semibold text-slate-800">Standard Member</span>. Only team administrators can view the full roster or register new user accounts. Contact your organization admin if you need elevated access.
          </div>
        )}
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

        <p className="text-xs text-slate-500">
          {isAdmin
            ? "The live status of your Apify token, task and webhook secret is shown in the “Apify Connection & Credentials” card above."
            : "Credential status is visible to administrators only."}
        </p>
      </div>

      {/* Modal: Add Team Member (Admin Only) */}
      {isAddUserModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-600" />
              Sign Up New Team User
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Create credentials for a new volunteer coordinator or administrator.
            </p>

            <form onSubmit={handleCreateUser} className="mt-5 space-y-4">
              {userFormError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span>{userFormError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    value={newUserFullName}
                    onChange={(e) => setNewUserFullName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    placeholder="john@team.org"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Password (min 8 characters)
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="••••••••"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Role Assignment
                </label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as "admin" | "member")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="member">Standard Member (View dashboard & metrics)</option>
                  <option value="admin">Administrator (Manage users, accounts, & scraper)</option>
                </select>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {submittingUser && <Loader2 className="h-4 w-4 animate-spin" />}
                  Register User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
