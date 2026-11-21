"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { useState, useEffect, useCallback } from "react";
import { Database, Cloud, CheckCircle2, AlertCircle, Loader2, RefreshCw, UserPlus, Trash2, Lock, Mail, User } from "lucide-react";
import { CardsSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchJson } from "@/lib/fetch-json";
import { Modal } from "@/components/ui/Modal";
import { Notice, type NoticeTone } from "@/components/ui/Notice";
import { Switch } from "@/components/ui/Switch";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
  const [userLoadError, setUserLoadError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);

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
  const [pageNotice, setPageNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [removingMember, setRemovingMember] = useState(false);

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
        message: next ? "Caption filter is on. Stored posts are being labelled against your captions." : "Caption filter is off. All posts are kept and no matching is done.",
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
    setSettingsLoadError(null);
    try {
      const data = await fetchJson<{
        strategy?: typeof strategy;
        platformSettings?: typeof platformSettings;
        featureSettings?: { campaign_captions_enabled: boolean };
        stats?: { totalTrackedPosts: number; eligibleForRefresh: number };
      }>("/api/admin/settings");
      if (data.strategy) setStrategy(data.strategy);
      if (data.platformSettings) setPlatformSettings(data.platformSettings);
      if (data.featureSettings) setCaptionsEnabled(data.featureSettings.campaign_captions_enabled);
      if (data.stats) setStrategyStats(data.stats);
    } catch (err: unknown) {
      setSettingsLoadError(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setLoadingStrategy(false);
    }
  }, []);

  const handleTogglePlatform = async (platformKey: "instagram" | "facebook" | "x", newEnabled: boolean) => {
    if (platformKey === "instagram") return; // Instagram is always collected; its switch is locked.
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
      const name = platformKey === "facebook" ? "Facebook" : "X";
      setPlatformNotice({
        type: "success",
        message: `${name} is now ${newEnabled ? "on" : "off"}. ${newEnabled ? "It will be included the next time you run “Collect data”." : "It will be skipped on future runs; stored posts are kept."}`,
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
      setStrategyNotice({ type: "success", message: "Saved." });
    } catch (err: unknown) {
      setStrategyNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Error saving strategy",
      });
    } finally {
      setSavingStrategy(false);
    }
  };

  const fetchTeamMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMembersError(null);
    try {
      const data = await fetchJson<{ users?: TeamMember[] }>("/api/admin/users");
      setTeamMembers(data.users || []);
    } catch (err: unknown) {
      setMembersError(err instanceof Error ? err.message : "Could not load the team list.");
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // Fetch current user and role
  const fetchCurrentUser = useCallback(async () => {
    setLoadingUser(true);
    setUserLoadError(null);
    try {
      const data = await fetchJson<{
        user?: { id: string; email: string };
        profile?: { role?: string; full_name?: string | null } | null;
        isAdmin?: boolean;
      }>("/api/auth/me");
      if (!data.user) throw new Error("Your session has expired. Please sign in again.");
      setCurrentUser({
        id: data.user.id,
        email: data.user.email,
        role: data.profile?.role || "member",
        full_name: data.profile?.full_name || null,
      });
      setIsAdmin(Boolean(data.isAdmin));
      fetchStrategy();
      if (data.isAdmin) fetchTeamMembers();
    } catch (err: unknown) {
      setUserLoadError(err instanceof Error ? err.message : "Could not load your account.");
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

      setPageNotice({ tone: "success", message: `${newUserEmail} was added as ${newUserRole === "admin" ? "an administrator" : "a standard member"}.` });
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

  const handleConfirmRemoveMember = async () => {
    if (!memberToRemove) return;
    setRemovingMember(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberToRemove.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPageNotice({ tone: "error", message: data.error || "Could not remove that user. Please try again." });
      } else {
        setPageNotice({ tone: "success", message: `${memberToRemove.email} no longer has access.` });
        fetchTeamMembers();
      }
    } catch (err: unknown) {
      setPageNotice({ tone: "error", message: err instanceof Error ? err.message : "Could not remove that user." });
    } finally {
      setRemovingMember(false);
      setMemberToRemove(null);
    }
  };


  const platformRows: { key: "instagram" | "facebook" | "x"; name: string; blurb: string }[] = [
    { key: "instagram", name: "Instagram", blurb: "Posts, reels, likes, comments and video views." },
    { key: "facebook", name: "Facebook", blurb: "Public page and profile posts: reactions, comments and shares." },
    { key: "x", name: "X", blurb: "Posts, replies, likes, reposts and view counts." },
  ];

  const numberInput =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500";

  const strategyOptions = [
    {
      mode: "30_day_cutoff" as const,
      title: "Stop after a set age",
      badge: "Lower cost (recommended)",
      text: "Keep refreshing a post for its first weeks, then freeze it. Fewer paid refreshes per post.",
    },
    {
      mode: "continuous" as const,
      title: "Keep refreshing",
      badge: "Full history",
      text: "Refresh every post on a schedule with no age limit. Best for tracking slow-growing posts, but costs more.",
    },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Settings"
        description="Choose which platforms are collected, how often posts are refreshed, connect Apify and manage who has access."
      />

      {pageNotice && (
        <Notice tone={pageNotice.tone} onDismiss={() => setPageNotice(null)}>
          {pageNotice.message}
        </Notice>
      )}

      {loadingUser && <CardsSkeleton count={4} />}

      {!loadingUser && userLoadError && (
        <ErrorState title="Couldn't load your settings" message={userLoadError} onRetry={fetchCurrentUser} />
      )}

      {!loadingUser && settingsLoadError && !userLoadError && (
        <Notice tone="error">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Couldn&apos;t load the saved settings: {settingsLoadError} The values below may not be current.</span>
            <button type="button" onClick={fetchStrategy} className="font-semibold underline">
              Try again
            </button>
          </div>
        </Notice>
      )}

      {!loadingUser && !userLoadError && (
        <>

      {/* Your account */}
      <SettingsCard title="Your account">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700" aria-hidden="true">
              {currentUser?.email ? currentUser.email[0].toUpperCase() : "U"}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {loadingUser ? "Loading..." : currentUser?.full_name || currentUser?.email || "Signed in"}
                </span>
                {!loadingUser && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                      isAdmin ? "border-blue-200 bg-blue-100 text-blue-700" : "border-slate-200 bg-slate-100 text-slate-700"
                    }`}
                  >
                    {isAdmin ? "Administrator" : "Standard member"}
                  </span>
                )}
              </div>
              <span className="font-mono text-xs text-slate-500">{currentUser?.email}</span>
            </div>
          </div>
          <p className="text-sm text-slate-600 sm:max-w-xs">
            {isAdmin
              ? "You can collect data, manage accounts, change these settings and add team members."
              : "You can view the dashboard. Ask an administrator to change settings."}
          </p>
        </div>
      </SettingsCard>

      {/* Platforms */}
      <SettingsCard
        title="Platforms to collect"
        description="Each platform is collected separately, so turning one off never affects the others. Stored posts are always kept."
      >
        {platformNotice && (
          <Notice tone={platformNotice.type} onDismiss={() => setPlatformNotice(null)} className="mb-4">
            {platformNotice.message}
          </Notice>
        )}
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {platformRows.map((row) => {
            const locked = row.key === "instagram";
            const on = locked ? true : Boolean(platformSettings[row.key]?.enabled);
            return (
              <li key={row.key} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                  <p className="text-sm text-slate-600">{row.blurb}</p>
                  {locked && <p className="mt-0.5 text-xs text-slate-500">Always collected. This one can&apos;t be turned off.</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`text-sm font-medium ${on ? "text-emerald-700" : "text-slate-500"}`}>{on ? "On" : "Off"}</span>
                  <Switch
                    checked={on}
                    label={`Collect ${row.name}`}
                    disabled={!isAdmin || savingPlatform || locked}
                    onChange={(next) => handleTogglePlatform(row.key, next)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {!isAdmin && <p className="mt-3 text-xs text-slate-500">Only administrators can change this.</p>}
      </SettingsCard>

      {/* Caption filter */}
      <SettingsCard
        title="Caption filter"
        description="Decide whether collected posts are compared against your campaign captions."
        action={<Switch checked={captionsEnabled} label="Caption filter" disabled={!isAdmin || savingFeature} onChange={handleToggleCaptions} />}
      >
        <ul className="space-y-1.5 text-sm text-slate-600">
          <li>
            <strong className="text-slate-900">Off:</strong> every post is kept as it is. No matching is done and the Campaign Captions page is hidden.
          </li>
          <li>
            <strong className="text-slate-900">On:</strong> each post is labelled as a campaign match, needs review, or not a match. Posts already stored are labelled too.
          </li>
        </ul>
        <p className="mt-2 text-sm text-slate-600">Either way, no post is ever deleted, and stored posts keep being refreshed.</p>
        {featureNotice && (
          <Notice tone={featureNotice.type} onDismiss={() => setFeatureNotice(null)} className="mt-4">
            {featureNotice.message}
          </Notice>
        )}
        {!isAdmin && <p className="mt-3 text-xs text-slate-500">Only administrators can change this.</p>}
      </SettingsCard>

      {/* Collection settings */}
      <SettingsCard
        title="Collection & refresh"
        description="Controls how many posts are collected each day and how long they keep being refreshed. These settings directly affect Apify cost."
      >
        <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-200/70 bg-slate-50 p-4 text-sm">
          <div>
            <div className="text-slate-500">Posts stored</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900">
              {strategyStats ? strategyStats.totalTrackedPosts.toLocaleString("en-IN") : loadingStrategy ? "Loading..." : "n/a"}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Due for refresh now</div>
            <div className="mt-0.5 text-lg font-bold text-indigo-700">
              {strategyStats ? strategyStats.eligibleForRefresh.toLocaleString("en-IN") : loadingStrategy ? "Loading..." : "n/a"}
            </div>
            <div className="text-xs text-slate-500">Refresh them from “Collect data” in the top bar.</div>
          </div>
        </div>

        <form onSubmit={handleSaveStrategy} className="space-y-5">
          <fieldset disabled={!isAdmin}>
            <legend className="mb-2 text-sm font-semibold text-slate-800">When should a post stop being refreshed?</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup">
              {strategyOptions.map((opt) => {
                const selected = strategy.mode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setStrategy((prev) => ({ ...prev, mode: opt.mode }))}
                    className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed ${
                      selected ? "border-blue-500 bg-blue-50/50 ring-1 ring-blue-400" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">{opt.title}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{opt.badge}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-600">{opt.text}</p>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="refresh-days" className="mb-1 block text-sm font-medium text-slate-800">
                Refresh every (days)
              </label>
              <input
                id="refresh-days"
                type="number"
                min={1}
                max={90}
                disabled={!isAdmin}
                value={strategy.refresh_interval_days}
                onChange={(e) => setStrategy((prev) => ({ ...prev, refresh_interval_days: parseInt(e.target.value, 10) || 7 }))}
                className={numberInput}
              />
              <span className="text-xs text-slate-500">Usually 7.</span>
            </div>
            <div>
              <label htmlFor="cutoff-days" className="mb-1 block text-sm font-medium text-slate-800">
                Stop refreshing after (days)
              </label>
              <input
                id="cutoff-days"
                type="number"
                min={7}
                max={365}
                disabled={!isAdmin || strategy.mode !== "30_day_cutoff"}
                value={strategy.cutoff_days}
                onChange={(e) => setStrategy((prev) => ({ ...prev, cutoff_days: parseInt(e.target.value, 10) || 30 }))}
                className={numberInput}
              />
              <span className="text-xs text-slate-500">
                {strategy.mode === "30_day_cutoff" ? "Usually 30." : "Not used when posts are refreshed forever."}
              </span>
            </div>
            <div>
              <label htmlFor="post-limit" className="mb-1 block text-sm font-medium text-slate-800">
                Posts per account per day
              </label>
              <input
                id="post-limit"
                type="number"
                min={1}
                max={50}
                disabled={!isAdmin}
                value={strategy.discovery_post_limit}
                onChange={(e) => setStrategy((prev) => ({ ...prev, discovery_post_limit: parseInt(e.target.value, 10) || 10 }))}
                className={numberInput}
              />
              <span className="text-xs text-slate-500">Upper limit for “Today’s new posts”. 6–8 is typical.</span>
            </div>
          </div>

          {strategyNotice && (
            <Notice tone={strategyNotice.type} onDismiss={() => setStrategyNotice(null)}>
              {strategyNotice.message}
            </Notice>
          )}

          {isAdmin ? (
            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button
                type="submit"
                disabled={savingStrategy}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {savingStrategy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Only administrators can change this.</p>
          )}
        </form>
      </SettingsCard>

      {/* Apify (admin only) */}
      {isAdmin && <IntegrationsCard />}
      {isAdmin && <ApifyUsageCard />}

      {/* Team */}
      <SettingsCard
        title="Team access"
        description="Administrators can collect data and change settings. Standard members can only view."
        action={
          isAdmin ? (
            <button
              onClick={() => {
                setUserFormError(null);
                setIsAddUserModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <UserPlus className="h-4 w-4" />
              Add team member
            </button>
          ) : undefined
        }
      >
        {isAdmin ? (
          membersError ? (
            <ErrorState compact title="Couldn't load the team" message={membersError} onRetry={fetchTeamMembers} />
          ) : loadingMembers ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Loading team members...
            </div>
          ) : teamMembers.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">No other team members yet. Use “Add team member” to invite one.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Name and email</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Added</th>
                    <th className="px-4 py-2.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-slate-900">{member.full_name || "Team member"}</div>
                        <div className="font-mono text-xs text-slate-500">{member.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                            member.role === "admin" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {member.role === "admin" ? "Administrator" : "Standard member"}
                        </span>
                      </td>
                      <td suppressHydrationWarning className="px-4 py-3 text-sm text-slate-500">
                        {formatDisplayDate(member.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {member.id !== currentUser?.id && (
                          <button
                            onClick={() => setMemberToRemove(member)}
                            className="rounded p-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                            title="Remove access"
                            aria-label={`Remove ${member.email}`}
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
          )
        ) : (
          <p className="text-sm text-slate-600">
            Only administrators can see the team list or add people. Contact an administrator if you need more access.
          </p>
        )}
      </SettingsCard>

      {/* Diagnostics */}
      <SettingsCard
        title="Connection check"
        description="Test that the app can reach its database and Apify. Run this if collection fails."
        action={
          <button
            onClick={handleTestConnections}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {testing ? "Testing..." : "Test connections"}
          </button>
        }
      >
        {testResult ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-live="polite">
            {[
              {
                name: "Database (Supabase)",
                Icon: Database,
                ok: testResult.results.supabase.ok,
                message: testResult.results.supabase.message,
                extra:
                  testResult.results.supabase.accountCount !== undefined
                    ? `Accounts in database: ${testResult.results.supabase.accountCount}`
                    : null,
              },
              {
                name: "Apify",
                Icon: Cloud,
                ok: testResult.results.apify.ok,
                message: testResult.results.apify.message,
                extra: testResult.results.apify.username ? `Apify account: @${testResult.results.apify.username}` : null,
              },
            ].map(({ name, Icon, ok, message, extra }) => (
              <div key={name} className={`rounded-xl border p-4 ${ok ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Icon className="h-4 w-4 text-slate-600" />
                    {name}
                  </span>
                  <span className={`flex items-center gap-1 text-xs font-semibold ${ok ? "text-emerald-700" : "text-red-700"}`}>
                    {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    {ok ? "Working" : "Problem"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{message}</p>
                {extra && <div className="mt-1 font-mono text-xs text-slate-500">{extra}</div>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Not tested yet.</p>
        )}
      </SettingsCard>

      <p className="px-1 text-xs text-slate-500">
        Secret keys stay on the server and are never sent to the browser.
        {isAdmin ? " The status of your Apify token is shown in the Apify card above." : ""}
      </p>

        </>
      )}

      <ConfirmDialog
        open={memberToRemove !== null}
        title="Remove this person's access?"
        confirmLabel="Remove access"
        danger
        busy={removingMember}
        onConfirm={handleConfirmRemoveMember}
        onCancel={() => setMemberToRemove(null)}
      >
        <strong>{memberToRemove?.email}</strong> will no longer be able to sign in. You can add them again later.
      </ConfirmDialog>

      {/* Add team member */}
      {isAddUserModalOpen && isAdmin && (
        <Modal size="md" labelledBy="add-user-title" onClose={() => setIsAddUserModalOpen(false)} className="p-6">
          <div>
            <h2 id="add-user-title" className="text-lg font-bold text-slate-900">
              Add team member
            </h2>
            <p className="mt-1 text-sm text-slate-500">They sign in with this email and password. Share the password with them securely.</p>

            <form onSubmit={handleCreateUser} className="mt-5 space-y-4">
              {userFormError && <Notice tone="error">{userFormError}</Notice>}

              {[
                { id: "nu-name", label: "Full name", Icon: User, type: "text", value: newUserFullName, set: setNewUserFullName, ph: "e.g. John Doe", auto: "name" },
                { id: "nu-email", label: "Email", Icon: Mail, type: "email", value: newUserEmail, set: setNewUserEmail, ph: "john@example.org", auto: "off" },
                { id: "nu-pass", label: "Password (at least 8 characters)", Icon: Lock, type: "password", value: newUserPassword, set: setNewUserPassword, ph: "", auto: "new-password" },
              ].map(({ id, label, Icon, type, value, set, ph, auto }) => (
                <div key={id}>
                  <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
                    {label}
                  </label>
                  <div className="relative">
                    <Icon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      id={id}
                      type={type}
                      required
                      minLength={type === "password" ? 8 : undefined}
                      autoComplete={auto}
                      placeholder={ph}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))}

              <div>
                <label htmlFor="nu-role" className="mb-1 block text-sm font-medium text-slate-800">
                  Role
                </label>
                <select
                  id="nu-role"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as "admin" | "member")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="member">Standard member (can view the dashboard)</option>
                  <option value="admin">Administrator (can collect data, manage accounts and settings)</option>
                </select>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {submittingUser && <Loader2 className="h-4 w-4 animate-spin" />}
                  Add member
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 max-w-xl text-sm text-slate-600">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
