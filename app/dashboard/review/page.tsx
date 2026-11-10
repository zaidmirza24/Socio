import { Suspense } from "react";
import { getReviewQueueItems } from "@/lib/supabase/reviews";
import { ReviewQueueView } from "@/components/review/ReviewQueueView";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const items = await getReviewQueueItems("ALL");

  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading review queue...</div>}>
      <ReviewQueueView initialItems={items} />
    </Suspense>
  );
}
