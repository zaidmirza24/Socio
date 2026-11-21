import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <TableSkeleton rows={10} columns={7} />
    </div>
  );
}
