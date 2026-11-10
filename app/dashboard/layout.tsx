import Link from "next/link";
import { 
  BarChart3, 
  Users, 
  Layers, 
  Activity, 
  Settings,
  PlayCircle,
  FileText,
  CheckSquare
} from "lucide-react";
import { TriggerScraperButton } from "@/components/TriggerScraperButton";
import { SignOutButton } from "@/components/SignOutButton";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col justify-between shrink-0">
        <div>
          <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              S
            </div>
            <div>
              <span className="font-semibold text-slate-900 text-sm block">Socio Monitor</span>
              <span className="text-xs text-slate-400">Instagram Campaign</span>
            </div>
          </div>

          <nav className="p-4 space-y-1">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <BarChart3 className="h-4 w-4" />
              Matrix &amp; Overview
            </Link>

            <Link
              href="/dashboard/captions"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <FileText className="h-4 w-4" />
              Campaign Captions
            </Link>

            <Link
              href="/dashboard/review"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <CheckSquare className="h-4 w-4" />
              Review Queue
            </Link>

            <Link
              href="/dashboard/accounts"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <Users className="h-4 w-4" />
              Accounts
            </Link>

            <Link
              href="/dashboard/posts"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <Layers className="h-4 w-4" />
              Recent Posts
            </Link>

            <Link
              href="/dashboard/health"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <Activity className="h-4 w-4" />
              System Health
            </Link>

            <Link
              href="/dashboard/settings"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 px-3 py-2 rounded-md border border-blue-200 font-medium">
            <PlayCircle className="h-4 w-4 text-blue-600 shrink-0" />
            <span>UI On-Demand Mode</span>
          </div>
          
          <SignOutButton variant="sidebar" />

          <div className="text-[11px] text-slate-400 text-center">
            Private Vercel Cloud Build
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-slate-50 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-200 bg-white px-8 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-slate-800">
            Social Media Engagement Monitoring
          </h2>
          <div className="flex items-center gap-3">
            <TriggerScraperButton />
            <SignOutButton variant="header" />
          </div>
        </header>

        <div className="p-8 flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
