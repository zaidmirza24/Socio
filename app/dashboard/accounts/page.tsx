"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  UserCheck,
  Plus,
  Search,
  PauseCircle,
  PlayCircle,
  Trash2,
  Edit2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Users,
  Instagram,
  RefreshCw,
} from "lucide-react";
import { TriggerScraperButton } from "@/components/TriggerScraperButton";

interface AccountItem {
  id: string;
  platform: "instagram" | "facebook";
  handle: string;
  volunteer_name: string;
  status: "active" | "paused" | "archived";
  postsCount: number;
  followers: number | null;
  added_at: string;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form inputs
  const [volunteerNameInput, setVolunteerNameInput] = useState("");
  const [handleInput, setHandleInput] = useState("");
  const [statusInput, setStatusInput] = useState<"active" | "paused">("active");

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load accounts");
      }
      setAccounts(data.accounts || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error fetching accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const openAddModal = () => {
    setVolunteerNameInput("");
    setHandleInput("");
    setStatusInput("active");
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (acc: AccountItem) => {
    setEditingAccount(acc);
    setVolunteerNameInput(acc.volunteer_name);
    setHandleInput(acc.handle);
    setStatusInput(acc.status === "paused" ? "paused" : "active");
    setFormError(null);
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          volunteer_name: volunteerNameInput,
          handle: handleInput,
          status: statusInput,
          platform: "instagram",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create account");
      }

      setIsAddModalOpen(false);
      fetchAccounts();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error adding account");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingAccount.id,
          volunteer_name: volunteerNameInput,
          handle: handleInput,
          status: statusInput,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update account");
      }

      setEditingAccount(null);
      fetchAccounts();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error updating account");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (acc: AccountItem) => {
    const newStatus = acc.status === "active" ? "paused" : "active";
    try {
      const res = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: acc.id,
          status: newStatus,
        }),
      });
      if (res.ok) {
        fetchAccounts();
      }
    } catch {
      // Silent catch or handled on next refresh
    }
  };

  const handleDeleteAccount = async (acc: AccountItem) => {
    if (!window.confirm(`Are you sure you want to remove @${acc.handle}? Associated posts and snapshot history will be deleted.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/accounts?id=${acc.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchAccounts();
      }
    } catch {
      // Silent catch
    }
  };

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesSearch =
        acc.volunteer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        acc.handle.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || acc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [accounts, searchQuery, statusFilter]);

  // Summary counts
  const totalAccounts = accounts.length;
  const activeCount = accounts.filter((a) => a.status === "active").length;
  const totalPostsTracked = accounts.reduce((acc, curr) => acc + (curr.postsCount || 0), 0);
  const totalFollowers = accounts.reduce((acc, curr) => acc + (curr.followers || 0), 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-blue-600" />
            Monitored Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage volunteer Instagram profiles tracked by the scraper.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            <Plus className="h-4 w-4" />
            Add Account
          </button>
          <TriggerScraperButton onCompleted={fetchAccounts} />
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Accounts</span>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totalAccounts}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Targets</span>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{activeCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Posts Tracked</span>
          <div className="mt-1 text-2xl font-bold text-blue-600">{totalPostsTracked}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Audience</span>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totalFollowers.toLocaleString()}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by volunteer or @handle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-9 pr-4 py-1.5 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {(["all", "active", "paused"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                statusFilter === tab
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab}
            </button>
          ))}
          <button
            onClick={fetchAccounts}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 ml-1"
            title="Refresh accounts"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-2" />
            <span className="text-sm">Loading accounts from database...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={fetchAccounts}
              className="mt-3 text-xs underline font-medium text-slate-600"
            >
              Retry
            </button>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Users className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No accounts found</p>
            <p className="text-xs text-slate-400 mt-1">
              {searchQuery ? "Try refining your search query." : "Click 'Add Account' to enroll your first volunteer profile."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5">Volunteer</th>
                  <th className="px-6 py-3.5">Instagram Handle</th>
                  <th className="px-6 py-3.5">Platform</th>
                  <th className="px-6 py-3.5">Scraper Status</th>
                  <th className="px-6 py-3.5 text-right">Posts Tracked</th>
                  <th className="px-6 py-3.5 text-right">Followers</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredAccounts.map((account) => (
                  <tr key={account.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      <Link
                        href={`/dashboard/volunteers/${account.handle}`}
                        className="flex items-center gap-2 hover:text-blue-600 hover:underline"
                      >
                        <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                        {account.volunteer_name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 font-medium text-blue-600">
                      <Link
                        href={`/dashboard/volunteers/${account.handle}`}
                        className="hover:underline flex items-center gap-1 font-mono text-xs"
                      >
                        @{account.handle}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-pink-50 text-pink-700 font-medium border border-pink-200">
                        <Instagram className="h-3 w-3" />
                        Instagram
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                          account.status === "active"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {account.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">{account.postsCount}</td>
                    <td className="px-6 py-4 text-right">
                      {account.followers !== null ? account.followers.toLocaleString() : "n/a"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleToggleStatus(account)}
                          title={account.status === "active" ? "Pause scraping" : "Activate scraping"}
                          className={`p-1.5 rounded-lg transition ${
                            account.status === "active"
                              ? "text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                              : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          }`}
                        >
                          {account.status === "active" ? (
                            <PauseCircle className="h-4 w-4" />
                          ) : (
                            <PlayCircle className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => openEditModal(account)}
                          title="Edit Account"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(account)}
                          title="Delete Account"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-600" />
              Add Monitored Account
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Add a volunteer profile. The on-demand scraper will target this account when you run the scraper.
            </p>

            <form onSubmit={handleCreateAccount} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Volunteer Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alice Volunteer"
                  value={volunteerNameInput}
                  onChange={(e) => setVolunteerNameInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Instagram Handle
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-slate-400">@</span>
                  <input
                    type="text"
                    required
                    placeholder="username"
                    value={handleInput}
                    onChange={(e) => setHandleInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Initial Status
                </label>
                <select
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value as "active" | "paused")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="active">Active (Targeted by scraper)</option>
                  <option value="paused">Paused (Skipped by scraper)</option>
                </select>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-blue-600" />
              Edit Account
            </h3>

            <form onSubmit={handleUpdateAccount} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Volunteer Name
                </label>
                <input
                  type="text"
                  required
                  value={volunteerNameInput}
                  onChange={(e) => setVolunteerNameInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Instagram Handle
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-slate-400">@</span>
                  <input
                    type="text"
                    required
                    value={handleInput}
                    onChange={(e) => setHandleInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Status
                </label>
                <select
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value as "active" | "paused")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="active">Active (Targeted by scraper)</option>
                  <option value="paused">Paused (Skipped by scraper)</option>
                </select>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Update Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
