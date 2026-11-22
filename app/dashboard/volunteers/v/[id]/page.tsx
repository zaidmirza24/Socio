import { notFound } from "next/navigation";
import { z } from "zod";
import { getVolunteerProfile, type DateRangePreset } from "@/lib/supabase/queries";
import { VolunteerDetailView } from "@/components/volunteers/VolunteerDetailView";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const rangeSchema = z.enum(["today", "7d", "30d", "180d", "all"]);

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}

/** One volunteer with ALL of their accounts (Instagram, Facebook, X) combined. */
export default async function VolunteerProfilePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const parsedRange = rangeSchema.safeParse(sp?.range);
  const initialRange: DateRangePreset = parsedRange.success ? parsedRange.data : "today";

  const data = await getVolunteerProfile(parsedId.data);
  if (!data) notFound();

  return <VolunteerDetailView data={data} initialRange={initialRange} />;
}
