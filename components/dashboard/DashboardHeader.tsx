"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { TriggerScraperButton } from "@/components/TriggerScraperButton";
import { SignOutButton } from "@/components/SignOutButton";
import { CommandPalette } from "./CommandPalette";
import { MobileSidebar } from "./MobileSidebar";
import {
  ChevronRight,
  Search,
  Menu,
  Sparkles,
  Command,
} from "lucide-react";

const ROUTE_LABELS: Record<string, { group: string; label: string }> = {
  "/dashboard": { group: "Monitoring", label: "Matrix & Overview" },
  "/dashboard/captions": { group: "Campaign", label: "Campaign Captions" },
  "/dashboard/review": { group: "Review", label: "Review Queue" },
  "/dashboard/accounts": { group: "Directory", label: "Volunteer Accounts" },
  "/dashboard/posts": { group: "Directory", label: "Recent Monitored Posts" },
  "/dashboard/health": { group: "Platform", label: "System Health & Runs" },
  "/dashboard/settings": { group: "Platform", label: "Settings & Access" },
};

export function DashboardHeader() {
  const pathname = usePathname();
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

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

  let breadcrumb = ROUTE_LABELS[pathname];
  if (!breadcrumb) {
    if (pathname.startsWith("/dashboard/volunteers/")) {
      const handle = pathname.split("/").pop();
      breadcrumb = { group: "Volunteers", label: `@${handle}` };
    } else {
      breadcrumb = { group: "Dashboard", label: "Overview" };
    }
  }

  return (
    <>
      <header className="sticky top-0 z-30 h-16 border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between shrink-0 shadow-xs">
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
            <span className="font-semibold text-slate-500 hidden sm:inline">
              Socio
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300 hidden sm:inline" />
            <span className="text-slate-400 hidden md:inline">{breadcrumb.group}</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300 hidden md:inline" />
            <h1 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight truncate">
              {breadcrumb.label}
            </h1>
          </div>
        </div>

        {/* Center / Right Section: Command Palette Trigger + Status + Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Fast Jump / Command Palette Search Button */}
          <button
            onClick={() => setIsCommandOpen(true)}
            className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white hover:border-slate-300 text-xs text-slate-500 hover:text-slate-800 transition shadow-2xs group"
            title="Fast Jump / Search (⌘K)"
          >
            <Search className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 transition-colors" />
            <span className="hidden sm:inline">Search or jump to...</span>
            <kbd className="inline-flex items-center gap-0.5 text-[10px] font-mono text-slate-400 bg-white group-hover:bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              <span className="text-[11px]">⌘</span>K
            </kbd>
          </button>

          {/* Live schedule pill (hidden on small screens) */}
          <div className="hidden xl:inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-[11px] font-semibold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>08:00 AM IST Sync</span>
          </div>

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          <TriggerScraperButton />
          <SignOutButton variant="header" />
        </div>
      </header>

      {/* Global Command Palette (⌘K) */}
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
