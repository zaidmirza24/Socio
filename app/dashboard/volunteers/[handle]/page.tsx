import { notFound } from "next/navigation";
import { getVolunteerDetails, type DateRangePreset } from "@/lib/supabase/queries";
import { VolunteerDetailView } from "@/components/volunteers/VolunteerDetailView";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ range?: string }>;
}

export default async function VolunteerDetailPage({ params, searchParams }: Props) {
  const { handle } = await params;
  const resolvedSearchParams = await searchParams;
  const decodedHandle = decodeURIComponent(handle);

  const initialRange: DateRangePreset =
    resolvedSearchParams?.range === "today" ||
    resolvedSearchParams?.range === "7d" ||
    resolvedSearchParams?.range === "30d" ||
    resolvedSearchParams?.range === "180d" ||
    resolvedSearchParams?.range === "all"
      ? (resolvedSearchParams.range as DateRangePreset)
      : "today";

  // Fetch all posts — no preset passed so DB returns every post for this volunteer.
  // Client-side dateFilter state handles all filtering interactively.
  const data = await getVolunteerDetails(decodedHandle);

  if (!data) {
    notFound();
  }

  return <VolunteerDetailView data={data} initialRange={initialRange} />;
}
