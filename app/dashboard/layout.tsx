import Link from "next/link";
import { 
  BarChart3, 
  Users, 
  Layers, 
  Activity, 
  ShieldCheck 
} from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col justify-between">
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
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-blue-700 bg-blue-50"
            >
              <BarChart3 className="h-4 w-4" />
              Overview
            </Link>

            <Link
              href="/dashboard/accounts"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <Users className="h-4 w-4" />
              Accounts (30)
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
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-md border border-emerald-200 mb-3">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Apify Daily: 8:00 AM IST</span>
          </div>
          <div className="text-xs text-slate-400 text-center">
            Private Vercel Cloud Build
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-slate-50 flex flex-col">
        <header className="h-16 border-b border-slate-200 bg-white px-8 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            Social Media Engagement Monitoring
          </h2>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600"></span>
              Daily Ingestion Active
            </span>
          </div>
        </header>

        <div className="p-8 flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

