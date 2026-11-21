import {
  BarChart3,
  Users,
  AtSign,
  Newspaper,
  Activity,
  Settings,
  FileText,
  CheckSquare,
} from "lucide-react";

export type NavIcon = React.ComponentType<{ className?: string }>;

export interface NavRoute {
  /** Stable key, also used by the command palette. */
  id: string;
  /** The one name used in the sidebar, breadcrumb, page title and ⌘K. */
  label: string;
  href: string;
  group: NavGroupName;
  icon: NavIcon;
  /** One-line description shown in the command palette. */
  description: string;
  /** Only highlight on an exact path match (the dashboard home). */
  exact?: boolean;
}

export type NavGroupName = "Campaign" | "People & Content" | "System";

export const NAV_ROUTES: NavRoute[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    group: "Campaign",
    icon: BarChart3,
    description: "Campaign totals, trends and the volunteer × caption matrix",
    exact: true,
  },
  {
    id: "captions",
    label: "Campaign Captions",
    href: "/dashboard/captions",
    group: "Campaign",
    icon: FileText,
    description: "Add and manage the captions you want to detect in posts",
  },
  {
    id: "review",
    label: "Review Queue",
    href: "/dashboard/review",
    group: "Campaign",
    icon: CheckSquare,
    description: "Confirm or reject posts that only partly match a caption",
  },
  {
    id: "volunteers",
    label: "Volunteers",
    href: "/dashboard/volunteers",
    group: "People & Content",
    icon: Users,
    description: "One row per volunteer, combined across platforms",
  },
  {
    id: "accounts",
    label: "Accounts",
    href: "/dashboard/accounts",
    group: "People & Content",
    icon: AtSign,
    description: "Add, import and manage monitored social accounts",
  },
  {
    id: "posts",
    label: "Posts",
    href: "/dashboard/posts",
    group: "People & Content",
    icon: Newspaper,
    description: "Every collected post with its latest engagement",
  },
  {
    id: "runs",
    label: "Collection Runs",
    href: "/dashboard/health",
    group: "System",
    icon: Activity,
    description: "History, status and cost of every data collection run",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/dashboard/settings",
    group: "System",
    icon: Settings,
    description: "Platforms, connections, caption filter and team access",
  },
];

export const NAV_GROUPS: NavGroupName[] = ["Campaign", "People & Content", "System"];

export function findRoute(pathname: string): NavRoute | undefined {
  return NAV_ROUTES.find((r) => r.href === pathname);
}
