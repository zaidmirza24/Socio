"use client";

import { platformLabel } from "@/lib/platform";
import { Modal } from "@/components/ui/Modal";
import { Notice } from "@/components/ui/Notice";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useState, useEffect, useMemo, useRef } from "react";
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
  Facebook,
  Twitter,
  RefreshCw,
  UploadCloud,
  FileText,
  Table as TableIcon,
  Sparkles,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatNumber, formatMetric } from "@/lib/utils";

interface AccountItem {
  id: string;
  platform: "instagram" | "facebook" | "x";
  handle: string;
  volunteer_name: string;
  status: "active" | "paused" | "archived";
  postsCount: number;
  followers: number | null;
  added_at: string;
}

interface ParsedVolunteer {
  id: string;
  volunteer_name: string;
  handle: string;
  platform: "instagram" | "facebook" | "x";
  status: "active" | "paused";
  isExisting: boolean;
  isDuplicateInBatch: boolean;
  isValid: boolean;
  errorMessage?: string;
}

interface GridRow {
  id: string;
  name: string;
  handle: string;
  platform: "instagram" | "facebook" | "x";
  status: "active" | "paused";
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<AccountItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [platformFilter, setPlatformFilter] = useState<"all" | "instagram" | "facebook" | "x">("all");

  // Single Add / Edit Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form inputs for single add/edit
  const [volunteerNameInput, setVolunteerNameInput] = useState("");
  const [handleInput, setHandleInput] = useState("");
  const [platformInput, setPlatformInput] = useState<"instagram" | "facebook" | "x">("instagram");
  const [statusInput, setStatusInput] = useState<"active" | "paused">("active");

  // Bulk Modal state
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<"paste" | "grid">("paste");
  const [bulkPlatformInput, setBulkPlatformInput] = useState<"instagram" | "facebook" | "x">("instagram");
  const [bulkTextInput, setBulkTextInput] = useState("");
  const [gridRows, setGridRows] = useState<GridRow[]>([
    { id: "1", name: "", handle: "", platform: "instagram", status: "active" },
    { id: "2", name: "", handle: "", platform: "instagram", status: "active" },
    { id: "3", name: "", handle: "", platform: "instagram", status: "active" },
  ]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkFormError, setBulkFormError] = useState<string | null>(null);
  const [bulkSuccessSummary, setBulkSuccessSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const closeAddModal = () => setIsAddModalOpen(false);
  const closeEditModal = () => setEditingAccount(null);
  const closeBulkModal = () => setIsBulkModalOpen(false);

  const openAddModal = () => {
    setVolunteerNameInput("");
    setHandleInput("");
    setPlatformInput("instagram");
    setStatusInput("active");
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const openBulkModal = () => {
    setBulkTextInput("");
    setBulkFormError(null);
    setBulkSuccessSummary(null);
    setBulkPlatformInput("instagram");
    setGridRows([
      { id: "1", name: "", handle: "", platform: "instagram", status: "active" },
      { id: "2", name: "", handle: "", platform: "instagram", status: "active" },
      { id: "3", name: "", handle: "", platform: "instagram", status: "active" },
    ]);
    setIsBulkModalOpen(true);
  };

  const openEditModal = (acc: AccountItem) => {
    setEditingAccount(acc);
    setVolunteerNameInput(acc.volunteer_name);
    setHandleInput(acc.handle);
    setPlatformInput(acc.platform || "instagram");
    setStatusInput(acc.status === "paused" ? "paused" : "active");
    setFormError(null);
  };

  // Helper to extract clean handle and auto-detect platform from URLs or raw strings
  const extractHandleAndPlatform = (
    raw: string,
    defaultPlatform: "instagram" | "facebook" | "x" = "instagram"
  ): { handle: string; platform: "instagram" | "facebook" | "x" } => {
    let text = raw.trim();
    let detectedPlatform = defaultPlatform;

    if (/instagram\.com/i.test(text)) {
      detectedPlatform = "instagram";
      text = text.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").split(/[?#]/)[0];
    } else if (/facebook\.com/i.test(text)) {
      detectedPlatform = "facebook";
      text = text.replace(/^https?:\/\/(www\.)?facebook\.com\//i, "").split(/[?#]/)[0];
      if (/profile\.php/i.test(text) && raw.includes("id=")) {
        const match = raw.match(/id=([0-9]+)/);
        if (match) text = match[1];
      }
    } else if (/(twitter\.com|x\.com)/i.test(text)) {
      detectedPlatform = "x";
      text = text.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "").split(/[?#]/)[0];
    }

    const cleanHandle = text.replace(/^@+/, "").replace(/\/+$/, "").trim().toLowerCase();
    return { handle: cleanHandle, platform: detectedPlatform };
  };

  const normalizeHandle = (raw: string, platform: "instagram" | "facebook" | "x" = "instagram") => {
    return extractHandleAndPlatform(raw, platform).handle;
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      const cleanHandle = normalizeHandle(handleInput, platformInput);
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          volunteer_name: volunteerNameInput,
          handle: cleanHandle,
          status: statusInput,
          platform: platformInput,
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
      const cleanHandle = normalizeHandle(handleInput, editingAccount.platform);
      const res = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingAccount.id,
          volunteer_name: volunteerNameInput,
          handle: cleanHandle,
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
        setPageError(null);
        fetchAccounts();
      } else {
        setPageError(`Could not ${newStatus === "paused" ? "pause" : "resume"} @${acc.handle}. Please try again.`);
      }
    } catch {
      setPageError(`Could not reach the server to update @${acc.handle}.`);
    }
  };

  const handleDeleteAccount = (acc: AccountItem) => setAccountToDelete(acc);

  const confirmDeleteAccount = async () => {
    const acc = accountToDelete;
    if (!acc) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/accounts?id=${acc.id}`, { method: "DELETE" });
      if (res.ok) {
        setPageError(null);
        fetchAccounts();
      } else {
        setPageError(`Could not delete @${acc.handle}. Please try again.`);
      }
    } catch {
      setPageError(`Could not reach the server to delete @${acc.handle}.`);
    } finally {
      setDeleting(false);
      setAccountToDelete(null);
    }
  };

  // Set of existing accounts (platform:handle) for quick lookup
  const existingHandlesSet = useMemo(() => {
    return new Set(accounts.map((a) => `${a.platform}:${a.handle.toLowerCase()}`));
  }, [accounts]);

  // Parse bulk text or grid input into structured preview items
  const parsedVolunteers = useMemo<ParsedVolunteer[]>(() => {
    const seenInBatch = new Set<string>();
    const items: ParsedVolunteer[] = [];

    if (bulkMode === "paste") {
      const lines = bulkTextInput.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        let name = "";
        let rawHandle = "";
        let linePlatform = bulkPlatformInput;
        let status: "active" | "paused" = "active";

        // Check for comma, tab, or pipe delimiters
        const delimiter = line.includes("\t")
          ? "\t"
          : line.includes(",")
          ? ","
          : line.includes("|")
          ? "|"
          : null;

        if (delimiter) {
          const parts = line.split(delimiter).map((p) => p.trim());
          if (parts.length >= 2) {
            const part0IsUrlOrHandle =
              parts[0].startsWith("@") ||
              /instagram\.com|facebook\.com|x\.com|twitter\.com/i.test(parts[0]);
            if (part0IsUrlOrHandle) {
              rawHandle = parts[0];
              name = parts[1];
            } else {
              name = parts[0];
              rawHandle = parts[1];
            }

            // Check parts[2] for platform or status
            if (parts[2]) {
              const p2 = parts[2].toLowerCase();
              if (p2.includes("pause")) {
                status = "paused";
              } else if (p2 === "facebook" || p2 === "fb") {
                linePlatform = "facebook";
              } else if (p2 === "x" || p2 === "twitter") {
                linePlatform = "x";
              } else if (p2 === "instagram" || p2 === "ig") {
                linePlatform = "instagram";
              }
            }

            // Check parts[3] for status if parts[2] was platform
            if (parts[3] && parts[3].toLowerCase().includes("pause")) {
              status = "paused";
            }
          } else {
            rawHandle = parts[0];
          }
        } else {
          rawHandle = line;
        }

        const { handle: cleanHandle, platform: detectedPlatform } = extractHandleAndPlatform(
          rawHandle,
          linePlatform
        );
        const finalPlatform = detectedPlatform;

        if (!name && cleanHandle) {
          name = cleanHandle.charAt(0).toUpperCase() + cleanHandle.slice(1);
        }

        const batchKey = `${finalPlatform}:${cleanHandle}`;
        const isValid = !!cleanHandle && cleanHandle.length >= 1;
        const isDuplicateInBatch = seenInBatch.has(batchKey);
        const isExisting = existingHandlesSet.has(batchKey);

        if (cleanHandle) {
          seenInBatch.add(batchKey);
        }

        items.push({
          id: `paste-${i}`,
          volunteer_name: name || cleanHandle,
          handle: cleanHandle,
          platform: finalPlatform,
          status,
          isExisting,
          isDuplicateInBatch,
          isValid,
          errorMessage: !isValid ? "Handle cannot be empty" : undefined,
        });
      }
    } else {
      // Grid mode
      for (let i = 0; i < gridRows.length; i++) {
        const row = gridRows[i];
        if (!row.name && !row.handle) continue; // Skip empty rows

        const { handle: cleanHandle, platform: detectedPlatform } = extractHandleAndPlatform(
          row.handle,
          row.platform
        );
        const finalPlatform = detectedPlatform || row.platform;
        const name =
          row.name.trim() ||
          (cleanHandle ? cleanHandle.charAt(0).toUpperCase() + cleanHandle.slice(1) : "");
        const batchKey = `${finalPlatform}:${cleanHandle}`;
        const isValid = !!cleanHandle && cleanHandle.length >= 1;
        const isDuplicateInBatch = seenInBatch.has(batchKey);
        const isExisting = existingHandlesSet.has(batchKey);

        if (cleanHandle) {
          seenInBatch.add(batchKey);
        }

        items.push({
          id: row.id,
          volunteer_name: name,
          handle: cleanHandle,
          platform: finalPlatform,
          status: row.status,
          isExisting,
          isDuplicateInBatch,
          isValid,
          errorMessage: !isValid ? "Missing account handle" : undefined,
        });
      }
    }

    return items;
  }, [bulkMode, bulkTextInput, gridRows, existingHandlesSet, bulkPlatformInput]);

  const validAccountsToSubmit = useMemo(() => {
    return parsedVolunteers.filter((v) => v.isValid && !v.isDuplicateInBatch);
  }, [parsedVolunteers]);

  const handleBulkSubmit = async () => {
    if (validAccountsToSubmit.length === 0) {
      setBulkFormError("Please enter at least one valid volunteer account.");
      return;
    }

    setBulkSubmitting(true);
    setBulkFormError(null);
    setBulkSuccessSummary(null);

    try {
      const res = await fetch("/api/accounts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: validAccountsToSubmit.map((acc) => ({
            volunteer_name: acc.volunteer_name,
            handle: acc.handle,
            status: acc.status,
            platform: acc.platform,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to bulk import accounts");
      }

      setBulkSuccessSummary(data.message || `Successfully added ${validAccountsToSubmit.length} accounts!`);
      fetchAccounts();

      // Close modal after brief feedback
      setTimeout(() => {
        setIsBulkModalOpen(false);
      }, 1200);
    } catch (err: unknown) {
      setBulkFormError(err instanceof Error ? err.message : "Error submitting bulk accounts");
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleLoadSampleData = () => {
    if (bulkPlatformInput === "facebook") {
      setBulkTextInput(
        `Pravind Yadav, pravind.yadav.sp\n` +
        `Youth SP News, youth.sp.official\n` +
        `Samajwadi Live, samajwadi.live`
      );
    } else if (bulkPlatformInput === "x") {
      setBulkTextInput(
        `Media Cell SP, @MediaCellSP\n` +
        `Akhilesh Voice, @samajwadi_voice\n` +
        `Youth with SP, @YouthwithSP`
      );
    } else {
      setBulkTextInput(
        `Anurag Yadav, @socialistt_anuragyadav\n` +
        `Youth with Akhilesh, @Youthwithakhilesh\n` +
        `Cycle with Akhilesh, @cyclewithakhilesh\n` +
        `Pravind Yadav, https://facebook.com/sp_pravind, facebook\n` +
        `Media Cell SP, @MediaCellSP, x`
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setBulkTextInput(text);
        setBulkMode("paste");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Reset
  };

  // Add row to grid
  const handleAddGridRow = () => {
    setGridRows((prev) => [
      ...prev,
      { id: String(Date.now()), name: "", handle: "", platform: bulkPlatformInput, status: "active" },
    ]);
  };

  // Update grid row
  const handleUpdateGridRow = (
    id: string,
    field: "name" | "handle" | "status" | "platform",
    val: string
  ) => {
    setGridRows((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, [field]: val } : row
      )
    );
  };

  // Delete grid row
  const handleDeleteGridRow = (id: string) => {
    setGridRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  // Filtered accounts for page display
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesSearch =
        acc.volunteer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        acc.handle.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || acc.status === statusFilter;
      const matchesPlatform = platformFilter === "all" || acc.platform === platformFilter;
      return matchesSearch && matchesStatus && matchesPlatform;
    });
  }, [accounts, searchQuery, statusFilter, platformFilter]);

  // Summary counts
  const totalAccounts = accounts.length;
  const activeCount = accounts.filter((a) => a.status === "active").length;
  const totalPostsTracked = accounts.reduce((acc, curr) => acc + (curr.postsCount || 0), 0);
  const totalFollowers = accounts.reduce((acc, curr) => acc + (curr.followers || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="The social media accounts collected on every run. Add accounts one at a time or import many at once; pause an account to skip it without losing its history."
        actions={
          <>
            <button
              onClick={openBulkModal}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
            >
              <UploadCloud className="h-4 w-4" />
              Import many
            </button>
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add account
            </button>
          </>
        }
      />

      {pageError && (
        <Notice tone="error" onDismiss={() => setPageError(null)}>
          {pageError}
        </Notice>
      )}

      <ConfirmDialog
        open={accountToDelete !== null}
        title="Delete this account?"
        confirmLabel="Delete account"
        danger
        busy={deleting}
        onConfirm={confirmDeleteAccount}
        onCancel={() => setAccountToDelete(null)}
      >
        <strong>@{accountToDelete?.handle}</strong> on {accountToDelete ? platformLabel(accountToDelete.platform) : ""} will be removed, along with all of its collected posts and engagement history. This can&apos;t be undone. To keep the history, pause the account instead.
      </ConfirmDialog>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Accounts</span>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totalAccounts}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active</span>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{activeCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Posts collected</span>
          <div className="mt-1 text-2xl font-bold text-blue-600">{totalPostsTracked}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total followers</span>
          <div suppressHydrationWarning className="mt-1 text-2xl font-bold text-slate-900">{formatNumber(totalFollowers)}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by volunteer or handle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-9 pr-4 py-1.5 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Platform Filter */}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
            <button
              onClick={() => setPlatformFilter("all")}
              className={`px-2.5 py-1 rounded-md transition ${
                platformFilter === "all"
                  ? "bg-white text-slate-900 shadow-sm font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All platforms
            </button>
            <button
              onClick={() => setPlatformFilter("instagram")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                platformFilter === "instagram"
                  ? "bg-white text-pink-700 shadow-sm font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Instagram className="h-3 w-3" />
              Instagram
            </button>
            <button
              onClick={() => setPlatformFilter("facebook")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                platformFilter === "facebook"
                  ? "bg-white text-blue-700 shadow-sm font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Facebook className="h-3 w-3" />
              Facebook
            </button>
            <button
              onClick={() => setPlatformFilter("x")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                platformFilter === "x"
                  ? "bg-white text-slate-900 shadow-sm font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Twitter className="h-3 w-3" />
              X
            </button>
          </div>

          {/* Status Filter */}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
            {(["all", "active", "paused"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-2.5 py-1 rounded-md capitalize transition ${
                  statusFilter === tab
                    ? "bg-slate-900 text-white shadow-sm font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <button
            onClick={fetchAccounts}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-600"
            title="Reload accounts" aria-label="Reload accounts"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-500">
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
          <div className="p-12 text-center text-slate-500">
            <Users className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No accounts found</p>
            <p className="text-xs text-slate-500 mt-1">
              {searchQuery || platformFilter !== "all" || statusFilter !== "all"
                ? "Try refining your search or filter criteria."
                : "Use “Add account” or “Import many” to start monitoring profiles."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5">Volunteer</th>
                  <th className="px-6 py-3.5">Handle</th>
                  <th className="px-6 py-3.5">Platform</th>
                  <th className="px-6 py-3.5">Collection</th>
                  <th className="px-6 py-3.5 text-right">Posts</th>
                  <th className="px-6 py-3.5 text-right">Followers</th>
                  <th className="px-6 py-3.5 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredAccounts.map((account) => (
                  <tr key={account.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      <Link
                        href={`/dashboard/volunteers/${account.handle}?platform=${account.platform}`}
                        className="flex items-center gap-2 hover:text-blue-600 hover:underline"
                      >
                        <UserCheck className="h-4 w-4 text-slate-500 shrink-0" />
                        {account.volunteer_name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 font-medium text-blue-600">
                      <Link
                        href={`/dashboard/volunteers/${account.handle}?platform=${account.platform}`}
                        className="hover:underline flex items-center gap-1 font-mono text-xs"
                      >
                        @{account.handle}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {account.platform === "facebook" ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium border border-blue-200">
                          <Facebook className="h-3 w-3" />
                          Facebook
                        </span>
                      ) : account.platform === "x" ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-900 text-white font-medium border border-slate-700">
                          <Twitter className="h-3 w-3" />
                          X
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-pink-50 text-pink-700 font-medium border border-pink-200">
                          <Instagram className="h-3 w-3" />
                          Instagram
                        </span>
                      )}
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
                    <td suppressHydrationWarning className="px-6 py-4 text-right">
                      {formatMetric(account.followers)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleToggleStatus(account)}
                          title={account.status === "active" ? "Pause (skip on collection runs)" : "Resume collection"}
                          className={`p-1.5 rounded-lg transition ${
                            account.status === "active"
                              ? "text-slate-500 hover:text-amber-600 hover:bg-amber-50"
                              : "text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
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
                          title="Edit account" aria-label={`Edit @${account.handle}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(account)}
                          title="Delete account" aria-label={`Delete @${account.handle}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition"
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

      {/* ========================================================================= */}
      {/* BULK ADD VOLUNTEERS MODAL - Best-in-Class UI/UX                          */}
      {/* ========================================================================= */}
      {isBulkModalOpen && (
        <Modal size="3xl" labelledBy="bulk-title" onClose={closeBulkModal} className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="bulk-title" className="text-lg font-bold text-slate-900">
                    Import many accounts
                  </h3>
                  <p className="text-xs text-slate-500">
                    Paste from Google Sheets / Excel, upload a CSV, or use the interactive grid.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBulkModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Feedback Banners */}
              {bulkFormError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span>{bulkFormError}</span>
                </div>
              )}

              {bulkSuccessSummary && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>{bulkSuccessSummary}</span>
                </div>
              )}

              {/* Platform Selector Bar & Mode Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Default Platform:
                  </span>
                  <div className="inline-flex rounded-lg bg-white border border-slate-200 p-0.5 text-xs font-semibold shadow-sm">
                    <button
                      type="button"
                      onClick={() => setBulkPlatformInput("instagram")}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition ${
                        bulkPlatformInput === "instagram"
                          ? "bg-pink-50 text-pink-700 ring-1 ring-pink-300"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      <Instagram className="h-3.5 w-3.5 text-pink-600" />
                      Instagram
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkPlatformInput("facebook")}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition ${
                        bulkPlatformInput === "facebook"
                          ? "bg-blue-50 text-blue-700 ring-1 ring-blue-300"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      <Facebook className="h-3.5 w-3.5 text-blue-600" />
                      Facebook
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkPlatformInput("x")}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition ${
                        bulkPlatformInput === "x"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      <Twitter className="h-3.5 w-3.5" />
                      X
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-500 italic">
                  💡 URLs like <span className="font-mono text-slate-700">facebook.com/...</span> or <span className="font-mono text-slate-700">x.com/...</span> auto-detect platform
                </div>
              </div>

              {/* Mode Tabs & Action Tools */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setBulkMode("paste")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                      bulkMode === "paste"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Paste Text / CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkMode("grid")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                      bulkMode === "grid"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <TableIcon className="h-3.5 w-3.5" />
                    Interactive Table Grid
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {bulkMode === "paste" && (
                    <>
                      <button
                        type="button"
                        onClick={handleLoadSampleData}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition"
                      >
                        <Sparkles className="h-3 w-3" />
                        Fill Sample Data
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200 transition"
                      >
                        <UploadCloud className="h-3 w-3" />
                        Upload File (.csv)
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.txt"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </>
                  )}
                  {bulkMode === "grid" && (
                    <button
                      type="button"
                      onClick={handleAddGridRow}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Row
                    </button>
                  )}
                </div>
              </div>

              {/* Mode 1: Paste Input */}
              {bulkMode === "paste" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Formats: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">Volunteer, @handle</code> or <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">Volunteer, handle, platform</code> or full profile URLs.
                    </span>
                    <span>{bulkTextInput.split("\n").filter((l) => l.trim()).length} lines</span>
                  </div>
                  <textarea
                    rows={6}
                    value={bulkTextInput}
                    onChange={(e) => setBulkTextInput(e.target.value)}
                    placeholder={
                      bulkPlatformInput === "facebook"
                        ? "Pravind Yadav, pravind.yadav.sp\nRahul Verma, https://facebook.com/rahul.initiatives\nsamajwadi.live"
                        : bulkPlatformInput === "x"
                        ? "Media Cell SP, @MediaCellSP\nAkhilesh Voice, @samajwadi_voice\nhttps://x.com/YouthwithSP"
                        : "Priya Sharma, @priyasharma_ngo\nRahul Verma, https://facebook.com/rahul.initiatives\nMedia Cell SP, @MediaCellSP, x\n@ananya_volunteer"
                    }
                    className="w-full rounded-xl border border-slate-300 p-3 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed placeholder:text-slate-300"
                  />
                </div>
              )}

              {/* Mode 2: Interactive Grid */}
              {bulkMode === "grid" && (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-xs">
                      <tr>
                        <th className="px-3 py-2">Volunteer Name</th>
                        <th className="px-3 py-2">Platform</th>
                        <th className="px-3 py-2">Handle / URL</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gridRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/50">
                          <td className="p-2">
                            <input
                              type="text"
                              placeholder="e.g. Alice Smith"
                              value={row.name}
                              onChange={(e) =>
                                handleUpdateGridRow(row.id, "name", e.target.value)
                              }
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="p-2">
                            <select
                              value={row.platform}
                              onChange={(e) =>
                                handleUpdateGridRow(
                                  row.id,
                                  "platform",
                                  e.target.value as "instagram" | "facebook" | "x"
                                )
                              }
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:border-blue-500 font-medium"
                            >
                              <option value="instagram">Instagram</option>
                              <option value="facebook">Facebook</option>
                              <option value="x">X</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <div className="relative">
                              <span className="absolute left-2 top-1 text-slate-500">@</span>
                              <input
                                type="text"
                                placeholder="handle or URL"
                                value={row.handle}
                                onChange={(e) =>
                                  handleUpdateGridRow(row.id, "handle", e.target.value)
                                }
                                className="w-full rounded-md border border-slate-200 pl-5 pr-2 py-1 text-xs focus:outline-none focus:border-blue-500 font-mono"
                              />
                            </div>
                          </td>
                          <td className="p-2">
                            <select
                              value={row.status}
                              onChange={(e) =>
                                handleUpdateGridRow(
                                  row.id,
                                  "status",
                                  e.target.value as "active" | "paused"
                                )
                              }
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                            >
                              <option value="active">Active</option>
                              <option value="paused">Paused</option>
                            </select>
                          </td>
                          <td className="p-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteGridRow(row.id)}
                              className="text-slate-500 hover:text-red-500 p-1"
                              title="Delete row"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Real-time Parsed Preview Section */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Live Parsed Preview
                    </span>
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-semibold">
                      {validAccountsToSubmit.length} Ready to Import
                    </span>
                  </div>
                  {parsedVolunteers.some((p) => p.isExisting) && (
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                      Existing handles will be refreshed (idempotent upsert)
                    </span>
                  )}
                </div>

                {parsedVolunteers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                    No accounts parsed yet. Paste lines above or fill in the grid to preview.
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-xs">
                        <tr>
                          <th className="px-3 py-2">Volunteer</th>
                          <th className="px-3 py-2">Platform</th>
                          <th className="px-3 py-2">Account Handle</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 text-right">Validation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedVolunteers.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/60">
                            <td className="px-3 py-2 font-medium text-slate-900">
                              {item.volunteer_name}
                            </td>
                            <td className="px-3 py-2">
                              {item.platform === "facebook" ? (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium border border-blue-200">
                                  <Facebook className="h-2.5 w-2.5" /> Facebook
                                </span>
                              ) : item.platform === "x" ? (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-slate-900 text-white font-medium border border-slate-700">
                                  <Twitter className="h-2.5 w-2.5" /> X
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-pink-50 text-pink-700 font-medium border border-pink-200">
                                  <Instagram className="h-2.5 w-2.5" /> Instagram
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-blue-600">
                              @{item.handle}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-block px-1.5 py-0.5 text-xs rounded font-semibold uppercase ${
                                  item.status === "active"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {item.isDuplicateInBatch ? (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                                  <AlertCircle className="h-3 w-3" />
                                  Duplicate in batch
                                </span>
                              ) : item.isExisting ? (
                                <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                                  <RefreshCw className="h-3 w-3" />
                                  Updates existing
                                </span>
                              ) : item.isValid ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  New account
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-red-500 font-medium">
                                  <AlertCircle className="h-3 w-3" />
                                  Invalid
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {validAccountsToSubmit.length > 0
                  ? `Ready to enroll ${validAccountsToSubmit.length} volunteer accounts into the tracking database.`
                  : "Enter volunteer details to proceed."}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkSubmit}
                  disabled={bulkSubmitting || validAccountsToSubmit.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {bulkSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing {validAccountsToSubmit.length}...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-4 w-4" />
                      Import {validAccountsToSubmit.length} Volunteers
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Single Add Account Modal */}
      {isAddModalOpen && (
        <Modal size="md" labelledBy="account-add-title" onClose={closeAddModal} className="p-6">
          <div>
            <h3 id="account-add-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-600" />
              Add account
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Add a volunteer’s profile. It is collected the next time you run “Collect data”.
            </p>

            <form onSubmit={handleCreateAccount} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Platform Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Platform
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPlatformInput("instagram")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                      platformInput === "instagram"
                        ? "bg-pink-50 border-pink-300 text-pink-700 shadow-sm ring-1 ring-pink-300"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Instagram className="h-3.5 w-3.5 text-pink-600" />
                    Instagram
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlatformInput("facebook")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                      platformInput === "facebook"
                        ? "bg-blue-50 border-blue-300 text-blue-700 shadow-sm ring-1 ring-blue-300"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Facebook className="h-3.5 w-3.5 text-blue-600" />
                    Facebook
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlatformInput("x")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                      platformInput === "x"
                        ? "bg-slate-900 border-slate-900 text-white shadow-sm ring-1 ring-slate-900"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Twitter className="h-3.5 w-3.5" />
                    X
                  </button>
                </div>
              </div>

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
                  {platformInput === "facebook"
                    ? "Facebook Profile / Page Handle"
                    : platformInput === "x"
                    ? "X Handle"
                    : "Instagram Handle"}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-slate-500">@</span>
                  <input
                    type="text"
                    required
                    placeholder={
                      platformInput === "facebook"
                        ? "username slug or profile URL"
                        : platformInput === "x"
                        ? "username or profile URL"
                        : "username or profile URL"
                    }
                    value={handleInput}
                    onChange={(e) => setHandleInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Pasting full URLs like <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">https://{platformInput === "facebook" ? "facebook.com/username" : platformInput === "x" ? "x.com/username" : "instagram.com/username"}</code> will automatically normalize the handle.
                </p>
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
                  <option value="active">Active (collected on every run)</option>
                  <option value="paused">Paused (skipped, history is kept)</option>
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
        </Modal>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <Modal size="md" labelledBy="account-edit-title" onClose={closeEditModal} className="p-6">
          <div>
            <h3 id="account-edit-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-blue-600" />
              Edit account
            </h3>

            <form onSubmit={handleUpdateAccount} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Platform Info */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Platform
                </label>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
                  {editingAccount.platform === "facebook" ? (
                    <>
                      <Facebook className="h-4 w-4 text-blue-600" />
                      <span className="text-xs font-semibold text-blue-700">Facebook Profile / Page</span>
                    </>
                  ) : editingAccount.platform === "x" ? (
                    <>
                      <Twitter className="h-4 w-4 text-slate-800" />
                      <span className="text-xs font-semibold text-slate-800">X Account</span>
                    </>
                  ) : (
                    <>
                      <Instagram className="h-4 w-4 text-pink-600" />
                      <span className="text-xs font-semibold text-pink-700">Instagram Profile</span>
                    </>
                  )}
                </div>
              </div>

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
                  Account Handle
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-slate-500">@</span>
                  <input
                    type="text"
                    required
                    value={handleInput}
                    onChange={(e) => setHandleInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
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
                  <option value="active">Active (collected on every run)</option>
                  <option value="paused">Paused (skipped, history is kept)</option>
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
        </Modal>
      )}
    </div>
  );
}
