import { notFound } from "next/navigation";
import { getVolunteerDetails } from "@/lib/supabase/queries";
import { VolunteerDetailView } from "@/components/volunteers/VolunteerDetailView";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ handle: string }>;
}

export default async function VolunteerDetailPage({ params }: Props) {
  const { handle } = await params;
  const decodedHandle = decodeURIComponent(handle);
  const data = await getVolunteerDetails(decodedHandle);

  if (!data) {
    notFound();
  }

  return <VolunteerDetailView data={data} />;
}
