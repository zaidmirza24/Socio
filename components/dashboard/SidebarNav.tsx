"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Users,
  Layers,
  Activity,
  Settings,
  FileText,
  CheckSquare,
  Sparkles,
} from "lucide-react";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badge?: string;
  badgeColor?: "amber" | "blue" | "default";
}

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    const fetchPendingCount = async () => {
      // Don't poll when the browser tab is hidden/minimized
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      try {
        const res = await fetch("/api/review-queue/count");
        if (res.ok) {
          const data = await res.json();
          if (isMounted && typeof data?.count === "number") {
            setPendingCount(data.count);
          }
        }
      } catch {
        // Silently ignore network hiccup
      }
    };

    fetchPendingCount();

    // Poll every 60s only when active, plus immediate refresh on tab focus
    const interval = setInterval(fetchPendingCount, 60000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchPendingCount();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const MONITORING_ITEMS: NavItem[] = [
    {
      name: "Matrix & Overview",
      href: "/dashboard",
      icon: BarChart3,
      exact: true,
    },
    {
      name: "Campaign Captions",
      href: "/dashboard/captions",
      icon: FileText,
    },
    {
      name: "Review Queue",
      href: "/dashboard/review",
      icon: CheckSquare,
      badge: pendingCount > 0 ? `${pendingCount} Pending` : undefined,
      badgeColor: pendingCount > 0 ? "amber" : "default",
    },
  ];

  const DIRECTORY_ITEMS: NavItem[] = [
    {
      name: "Accounts & Volunteers",
      href: "/dashboard/accounts",
      icon: Users,
    },
    {
      name: "Recent Posts",
      href: "/dashboard/posts",
      icon: Layers,
    },
  ];

  const SYSTEM_ITEMS: NavItem[] = [
    {
      name: "System Health & Runs",
      href: "/dashboard/health",
      icon: Activity,
    },
    {
      name: "Settings & Access",
      href: "/dashboard/settings",
      icon: Settings,
    },
  ];

  const isLinkActive = (item: NavItem) => {
    if (item.exact) {
      return pathname === item.href;
    }
    return pathname.startsWith(item.href);
  };

  const renderNavGroup = (title: string, items: NavItem[]) => (
    <div className="space-y-1">
      <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {title}
      </div>
      <div className="space-y-0.5 mt-1.5">
        {items.map((item) => {
          const active = isLinkActive(item);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                active
                  ? "bg-blue-50 text-blue-700 font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    active ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
                  }`}
                />
                <span className="truncate">{item.name}</span>
              </div>

              {item.badge && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    item.badgeColor === "amber"
                      ? "bg-amber-100 text-amber-800 animate-pulse border border-amber-200"
                      : active
                      ? "bg-blue-200/60 text-blue-800"
                      : "bg-slate-100 text-slate-600 group-hover:bg-slate-200/70"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <nav className="p-4 space-y-5">
      {renderNavGroup("Campaign Intel", MONITORING_ITEMS)}
      {renderNavGroup("Directory", DIRECTORY_ITEMS)}
      {renderNavGroup("Platform", SYSTEM_ITEMS)}
    </nav>
  );
}
