import { Bike } from "lucide-react";
import { SidebarNav } from "@/components/dashboard/SidebarNav";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { SignOutButton } from "@/components/SignOutButton";
import { ScheduledRunSync } from "@/components/schedules/ScheduledRunSync";
import { isCurrentUserAdmin } from "@/lib/supabase/require-admin";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await isCurrentUserAdmin();
  return (
    <div className="flex min-h-screen bg-slate-50 antialiased selection:bg-blue-100 selection:text-blue-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Skip to content
      </a>
      {isAdmin && <ScheduledRunSync />}
      {/* Sidebar Navigation (Desktop) */}
      <aside className="hidden lg:flex w-64 border-r border-slate-200/90 bg-white flex-col justify-between shrink-0 sticky top-0 h-screen z-40">
        <div className="overflow-y-auto">
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200/80 bg-slate-50/50">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20"><Bike className="h-5 w-5" />
              S
            </div>
            <div className="min-w-0">
              <span className="font-bold text-slate-900 text-sm tracking-tight truncate block">Saikil Shakti</span>
              <span className="text-xs text-slate-500 block truncate">PDA ki Awaaz · Engagement tracker</span>
            </div>
          </div>

          {/* Grouped Sidebar Navigation */}
          <SidebarNav />
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-200/80 bg-slate-50/40 space-y-3">
          <SignOutButton variant="sidebar" />

        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />

        <main id="main" className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
