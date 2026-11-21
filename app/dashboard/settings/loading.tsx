import { PageHeaderSkeleton, CardsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-4xl space-y-6" aria-busy="true">
      <PageHeaderSkeleton controls={false} />
      <CardsSkeleton count={4} />
    </div>
  );
}
