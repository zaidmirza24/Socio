"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReviewCount } from "@/hooks/useReviewCount";
import { useFeatureSettings } from "@/hooks/useFeatureSettings";
import { NAV_GROUPS, NAV_ROUTES, type NavRoute } from "./nav-config";

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  // Single shared poll: all SidebarNav instances (desktop + mobile) share one fetch.
  const pendingCount = useReviewCount();
  const { campaign_captions_enabled } = useFeatureSettings();

  const isActive = (route: NavRoute) =>
    route.exact ? pathname === route.href : pathname.startsWith(route.href);

  const visible = NAV_ROUTES.filter((r) => r.id !== "captions" || campaign_captions_enabled);

  return (
    <nav className="p-4 space-y-5" aria-label="Main navigation">
      {NAV_GROUPS.map((group) => (
        <div key={group}>
          <div className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{group}</div>
          <ul className="space-y-0.5 mt-1.5">
            {visible
              .filter((r) => r.group === group)
              .map((route) => {
                const active = isActive(route);
                const Icon = route.icon;
                const badge = route.id === "review" && pendingCount > 0 ? pendingCount : null;

                return (
                  <li key={route.href}>
                    <Link
                      href={route.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        active
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            active ? "text-blue-600" : "text-slate-500 group-hover:text-slate-600"
                          }`}
                        />
                        <span className="truncate">{route.label}</span>
                      </span>

                      {badge !== null && (
                        <span
                          className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 tabular-nums"
                          title={`${badge} post${badge === 1 ? "" : "s"} waiting for review`}
                        >
                          {badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
