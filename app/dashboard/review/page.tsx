import { Suspense } from "react";
import { getReviewQueueItems, getNearMissPosts } from "@/lib/supabase/reviews";
import { ReviewQueueView } from "@/components/review/ReviewQueueView";

export const dynamic = "force-dynamic";

/** How many recent days the "Possible matches" lane covers. */
const NEAR_MISS_DAYS = 14;

export default async function ReviewPage() {
  const [items, nearMisses] = await Promise.all([getReviewQueueItems("ALL"), getNearMissPosts(NEAR_MISS_DAYS)]);

  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading review queue...</div>}>
      <ReviewQueueView initialItems={items} nearMisses={nearMisses} nearMissDays={NEAR_MISS_DAYS} />
    </Suspense>
  );
}
