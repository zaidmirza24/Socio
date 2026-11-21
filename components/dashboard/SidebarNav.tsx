"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReviewCount } from "@/hooks/useReviewCount";
import { useFeatureSettings } from "@/hooks/useFeatureSettings";
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
  // Single shared poll — all SidebarNav instances (desktop + mobile) share one fetch
  const pendingCount = useReviewCount();
  const { campaign_captions_enabled } = useFeatureSettings();

  const MONITORING_ITEMS: NavItem[] = [
    {
      name: "Matrix & Overview",
      href: "/dashboard",
      icon: BarChart3,
      exact: true,
    },
    ...(campaign_captions_enabled
      ? [
          {
            name: "Campaign Captions",
            href: "/dashboard/captions",
            icon: FileText,
          } satisfies NavItem,
        ]
      : []),
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
      name: "Volunteers",
      href: "/dashboard/volunteers",
      icon: Users,
    },
    {
      name: "Accounts",
      href: "/dashboard/accounts",
      icon: Layers,
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
