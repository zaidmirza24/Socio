/** Placeholder shapes shown while data loads. Pulse is disabled for reduced-motion users. */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200/80 motion-reduce:animate-none ${className}`} />;
}

/** Matches PageHeader: title, one line of description and an optional row of controls. */
export function PageHeaderSkeleton({ controls = true }: { controls?: boolean }) {
  return (
    <div className="space-y-4 border-b border-slate-200/80 pb-5">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full max-w-xl" />
      {controls && (
        <div className="flex flex-wrap gap-2.5">
          <Skeleton className="h-9 w-56 rounded-xl" />
          <Skeleton className="h-9 w-44 rounded-lg" />
          <Skeleton className="h-9 w-72 rounded-xl" />
        </div>
      )}
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-4 h-8 w-24" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" role="status" aria-label="Loading">
      <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-4">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={`h-4 flex-1 ${c === 0 ? "max-w-[12rem]" : ""}`} />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function ChartSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5" role="status" aria-label="Loading chart">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-64" />
      <Skeleton className={`mt-5 w-full ${height}`} />
    </div>
  );
}

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-4 w-full max-w-lg" />
          <div className="mt-5 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}
