"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { RunScraperPanel } from "@/components/RunScraperPanel";
import { findRoute } from "./nav-config";
import { CommandPalette } from "./CommandPalette";
import { MobileSidebar } from "./MobileSidebar";
import { ChevronRight, Search, Menu } from "lucide-react";

export function DashboardHeader() {
  const pathname = usePathname();
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [lastRunLabel, setLastRunLabel] = useState("No collections yet");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/runs?range=all&limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { runs?: { started_at: string; status: string }[] } | null) => {
        const latest = d?.runs?.[0];
        if (!cancelled && latest) {
          const when = new Date(latest.started_at).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
          setLastRunLabel(`Last collection ${when} IST`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Global keydown shortcut listener (⌘K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const route = findRoute(pathname);
  let breadcrumb: { group: string; label: string };
  if (route) {
    breadcrumb = { group: route.group, label: route.label };
  } else if (pathname.startsWith("/dashboard/volunteers/v/")) {
    breadcrumb = { group: "Volunteers", label: "Volunteer profile" };
  } else if (pathname.startsWith("/dashboard/volunteers/")) {
    breadcrumb = { group: "Volunteers", label: `@${decodeURIComponent(pathname.split("/").pop() ?? "")}` };
  } else {
    breadcrumb = { group: "Campaign", label: "Dashboard" };
  }

  return (
    <>
      <header className="sticky top-0 z-30 min-h-16 border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 shrink-0 shadow-xs">
        {/* Left Section: Mobile Menu + Breadcrumbs */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile Menu Hamburger Button */}
          <button
            onClick={() => setIsMobileNavOpen(true)}
            className="p-2 -ml-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 lg:hidden transition"
            aria-label="Open sidebar menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumb Path */}
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs truncate">
            <span className="text-slate-500 hidden md:inline">{breadcrumb.group}</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300 hidden md:inline" />
            <span className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight truncate" aria-current="page">
              {breadcrumb.label}
            </span>
          </div>
        </div>

        {/* Center / Right Section: Command Palette Trigger + Status + Actions */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Fast Jump / Command Palette Search Button */}
          <button
            onClick={() => setIsCommandOpen(true)}
            className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white hover:border-slate-300 text-xs text-slate-500 hover:text-slate-800 transition shadow-2xs group"
            title="Search pages and volunteers (Ctrl+K)" aria-label="Search pages and volunteers"
          >
            <Search className="h-3.5 w-3.5 text-slate-500 group-hover:text-blue-600 transition-colors" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-xs font-mono text-slate-500 bg-white group-hover:bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              Ctrl K
            </kbd>
          </button>

          {/* Last collection run (real data, hidden on small screens) */}
          <div className="hidden xl:inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200/70 text-xs font-medium">
            <span>{lastRunLabel}</span>
          </div>

          <RunScraperPanel />
        </div>
      </header>

      {/* Global search (Ctrl/Cmd+K) */}
      <CommandPalette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
      />

      {/* Mobile Drawer (Visible on < lg) */}
      <MobileSidebar
        isOpen={isMobileNavOpen}
        onClose={() => setIsMobileNavOpen(false)}
      />
    </>
  );
}
