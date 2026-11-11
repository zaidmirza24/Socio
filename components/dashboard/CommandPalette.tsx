"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  BarChart3,
  FileText,
  CheckSquare,
  Users,
  Layers,
  Activity,
  Settings,
  Download,
  Play,
  ArrowRight,
  ExternalLink,
  X,
  Sparkles,
} from "lucide-react";

interface NavOption {
  id: string;
  category: "Navigation" | "Quick Actions" | "Volunteers";
  title: string;
  subtitle?: string;
  href?: string;
  action?: () => void;
  icon: React.ComponentType<{ className?: string }>;
}

const STATIC_NAV_OPTIONS: NavOption[] = [
  {
    id: "nav-matrix",
    category: "Navigation",
    title: "Matrix & Overview",
    subtitle: "Real-time volunteer x caption monitoring matrix",
    href: "/dashboard",
    icon: BarChart3,
  },
  {
    id: "nav-captions",
    category: "Navigation",
    title: "Campaign Captions Registry",
    subtitle: "Manage canonical campaign copy and imports",
    href: "/dashboard/captions",
    icon: FileText,
  },
  {
    id: "nav-review",
    category: "Navigation",
    title: "Review Queue",
    subtitle: "Approve or reject candidate post matches",
    href: "/dashboard/review",
    icon: CheckSquare,
  },
  {
    id: "nav-accounts",
    category: "Navigation",
    title: "Volunteer Accounts Directory",
    subtitle: "Manage monitored accounts and bulk import",
    href: "/dashboard/accounts",
    icon: Users,
  },
  {
    id: "nav-posts",
    category: "Navigation",
    title: "Recent Monitored Posts",
    subtitle: "Browse all ingested Instagram posts",
    href: "/dashboard/posts",
    icon: Layers,
  },
  {
    id: "nav-health",
    category: "Navigation",
    title: "System Health & Run Audits",
    subtitle: "Inspect Apify scraping runs and error logs",
    href: "/dashboard/health",
    icon: Activity,
  },
  {
    id: "nav-settings",
    category: "Navigation",
    title: "Settings & Team Access",
    subtitle: "Credentials, connections, and user management",
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    id: "action-export",
    category: "Quick Actions",
    title: "Export Engagement Snapshots (CSV)",
    subtitle: "Download all historical point-in-time metrics",
    href: "/api/export/snapshots",
    icon: Download,
  },
];

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [volunteerAccounts, setVolunteerAccounts] = useState<
    { handle: string; volunteer_name: string }[]
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load volunteers on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      fetch("/api/accounts")
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data?.accounts)) {
            setVolunteerAccounts(
              data.accounts.map((a: { handle: string; volunteer_name: string }) => ({
                handle: a.handle,
                volunteer_name: a.volunteer_name,
              }))
            );
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Keyboard shortcut listener for escape / arrows / enter
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Combine static options + volunteer accounts matching the query
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();

    const matchedStatic = STATIC_NAV_OPTIONS.filter((opt) => {
      if (!q) return true;
      return (
        opt.title.toLowerCase().includes(q) ||
        (opt.subtitle && opt.subtitle.toLowerCase().includes(q))
      );
    });

    let matchedVolunteers: NavOption[] = [];
    if (q) {
      matchedVolunteers = volunteerAccounts
        .filter(
          (v) =>
            v.handle.toLowerCase().includes(q) ||
            v.volunteer_name.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .map((v) => ({
          id: `vol-${v.handle}`,
          category: "Volunteers" as const,
          title: `@${v.handle}`,
          subtitle: v.volunteer_name,
          href: `/dashboard/volunteers/${v.handle}`,
          icon: Users,
        }));
    }

    return [...matchedStatic, ...matchedVolunteers];
  }, [query, volunteerAccounts]);

  // Clamp selection index
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredOptions]);

  const executeItem = (item: NavOption) => {
    onClose();
    if (item.action) {
      item.action();
    } else if (item.href) {
      if (item.href.startsWith("/api/")) {
        window.open(item.href, "_blank");
      } else {
        router.push(item.href);
      }
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (filteredOptions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = filteredOptions[selectedIndex];
      if (current) executeItem(current);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 md:p-20 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="relative flex items-center px-4 border-b border-slate-200">
          <Search className="h-5 w-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a page, command, or search volunteer @handle..."
            className="w-full py-4 pl-3 pr-8 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent focus:outline-none"
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-2 divide-y divide-slate-100">
          {filteredOptions.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Search className="h-8 w-8 mx-auto mb-2 text-slate-300" />
              <p className="text-xs font-semibold text-slate-700">No matching destinations found</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Try searching for &quot;Matrix&quot;, &quot;Captions&quot;, &quot;Review&quot;, or a volunteer name.
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredOptions.map((opt, idx) => {
                const Icon = opt.icon;
                const isSelected = idx === selectedIndex;

                return (
                  <button
                    key={opt.id}
                    onClick={() => executeItem(opt)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors ${
                      isSelected
                        ? "bg-blue-50 text-blue-900"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isSelected
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold truncate block">
                            {opt.title}
                          </span>
                          <span
                            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded ${
                              isSelected
                                ? "bg-blue-200/80 text-blue-800"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {opt.category}
                          </span>
                        </div>
                        {opt.subtitle && (
                          <div className="text-[11px] text-slate-400 truncate">
                            {opt.subtitle}
                          </div>
                        )}
                      </div>
                    </div>

                    <ArrowRight
                      className={`h-4 w-4 shrink-0 transition-opacity ${
                        isSelected ? "text-blue-600 opacity-100" : "opacity-0"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with tips */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">↑</kbd>
              <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 ml-1">↓</kbd> to navigate
            </span>
            <span>
              <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">↵</kbd> to select
            </span>
          </div>
          <span>Socio Fast Jump</span>
        </div>
      </div>
    </div>
  );
}

