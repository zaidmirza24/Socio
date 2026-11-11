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
} from "lucide-react";
import { formatDisplayDate } from "@/lib/utils";

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
  }, [fetchTeamMembers]);

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
