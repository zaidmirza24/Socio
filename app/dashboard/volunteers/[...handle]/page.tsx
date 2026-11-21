import { notFound } from "next/navigation";
import { getVolunteerDetails, type DateRangePreset } from "@/lib/supabase/queries";
import { VolunteerDetailView } from "@/components/volunteers/VolunteerDetailView";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ handle: string[] | string }>;
  searchParams: Promise<{ range?: string; platform?: string }>;
}

export default async function VolunteerDetailPage({ params, searchParams }: Props) {
  const { handle } = await params;
  const resolvedSearchParams = await searchParams;
  const rawHandle = Array.isArray(handle)
    ? handle.map(decodeURIComponent).join("/")
    : decodeURIComponent(handle || "");
  const platform = resolvedSearchParams?.platform;

  const initialRange: DateRangePreset =
    resolvedSearchParams?.range === "today" ||
    resolvedSearchParams?.range === "7d" ||
    resolvedSearchParams?.range === "30d" ||
    resolvedSearchParams?.range === "180d" ||
    resolvedSearchParams?.range === "all"
      ? (resolvedSearchParams.range as DateRangePreset)
      : "today";

  // Fetch all posts — pass platform if present for multi-platform disambiguation
  const data = await getVolunteerDetails(rawHandle, undefined, platform);

  if (!data) {
    notFound();
  }

  return <VolunteerDetailView data={data} initialRange={initialRange} />;
}
