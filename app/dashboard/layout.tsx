import { SidebarNav } from "@/components/dashboard/SidebarNav";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { SignOutButton } from "@/components/SignOutButton";
import { ShieldCheck, Activity } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50 antialiased selection:bg-blue-100 selection:text-blue-900">
      {/* Sidebar Navigation (Desktop) */}
      <aside className="hidden lg:flex w-64 border-r border-slate-200/90 bg-white flex-col justify-between shrink-0 sticky top-0 h-screen z-40">
        <div className="overflow-y-auto">
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200/80 bg-slate-50/50">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-base shadow-sm shadow-blue-500/20">
              S
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-900 text-sm tracking-tight truncate">
                  Socio Monitor
                </span>
                <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded-full">
                  v2.0
                </span>
              </div>
              <span className="text-[11px] text-slate-400 block truncate">
                Instagram Campaign Intel
              </span>
            </div>
          </div>

          {/* Grouped Sidebar Navigation */}
          <SidebarNav />
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-200/80 bg-slate-50/40 space-y-3">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-slate-200/80 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[11px] font-medium text-slate-700">Cluster Status</span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
              Healthy
            </span>
          </div>

          <SignOutButton variant="sidebar" />

          <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
            <ShieldCheck className="h-3 w-3 text-slate-400" />
            <span>Private Vercel Cloud Build</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />

        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
