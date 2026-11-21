import Link from "next/link";
import { SearchX } from "lucide-react";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-10 text-center">
      <SearchX className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-bold text-slate-900">Not found</h1>
      <p className="mt-1 text-sm text-slate-600">
        We couldn&apos;t find that page or volunteer. It may have been removed, or the link may be wrong.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/dashboard/volunteers" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Browse volunteers
        </Link>
        <Link href="/dashboard" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
