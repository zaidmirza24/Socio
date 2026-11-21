import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

/** Default loading state for every dashboard page that has no more specific one. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <StatCardsSkeleton />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
