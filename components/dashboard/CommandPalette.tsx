"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFeatureSettings } from "@/hooks/useFeatureSettings";
import { Search, Users, Download, ArrowRight, X } from "lucide-react";
import { NAV_ROUTES } from "./nav-config";

interface NavOption {
  id: string;
  category: "Pages" | "Actions" | "Volunteers";
  title: string;
  subtitle?: string;
  href?: string;
  action?: () => void;
  icon: React.ComponentType<{ className?: string }>;
}

const STATIC_NAV_OPTIONS: NavOption[] = [
  ...NAV_ROUTES.map(
    (r): NavOption => ({
      id: `nav-${r.id}`,
      category: "Pages",
      title: r.label,
      subtitle: r.description,
      href: r.href,
      icon: r.icon,
    })
  ),
  {
    id: "action-export",
    category: "Actions",
    title: "Export engagement snapshots (CSV)",
    subtitle: "Download every daily engagement record",
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
  const { campaign_captions_enabled } = useFeatureSettings();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [volunteerAccounts, setVolunteerAccounts] = useState<
    { handle: string; volunteer_name: string; platform: string }[]
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
              data.accounts.map((a: { handle: string; volunteer_name: string; platform: string }) => ({
                handle: a.handle,
                volunteer_name: a.volunteer_name,
                platform: a.platform ?? "instagram",
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
      if (opt.id === "nav-captions" && !campaign_captions_enabled) return false;
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
          id: `vol-${v.handle}-${v.platform}`,
          category: "Volunteers" as const,
          title: `@${v.handle}`,
          subtitle: v.volunteer_name,
          href: `/dashboard/volunteers/${v.handle}?platform=${v.platform}`,
          icon: Users,
        }));
    }

    return [...matchedStatic, ...matchedVolunteers];
  }, [query, volunteerAccounts, campaign_captions_enabled]);

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
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] sm:pt-[14vh] bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[75dvh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="relative flex items-center px-4 border-b border-slate-200">
          <Search className="h-5 w-5 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search pages, or a volunteer name or @handle..."
            aria-label="Search pages and volunteers"
            className="w-full py-4 pl-3 pr-8 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent focus:outline-none"
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-slate-500 hover:text-slate-600 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-2 divide-y divide-slate-100">
          {filteredOptions.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Search className="h-8 w-8 mx-auto mb-2 text-slate-300" />
              <p className="text-xs font-semibold text-slate-700">Nothing found</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Try a page name like &quot;Posts&quot; or &quot;Settings&quot;, or a volunteer name or @handle.
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
                            className={`text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              isSelected
                                ? "bg-blue-200/80 text-blue-800"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {opt.category}
                          </span>
                        </div>
                        {opt.subtitle && (
                          <div className="text-xs text-slate-500 truncate">
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
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">↑</kbd>
              <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 ml-1">↓</kbd> to navigate
            </span>
            <span>
              <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">↵</kbd> to select
            </span>
          </div>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}

