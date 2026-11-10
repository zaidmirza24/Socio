import { getCampaignCaptions } from "@/lib/supabase/captions";
import { CaptionManagementView } from "@/components/captions/CaptionManagementView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CaptionsPage() {
  const captions = await getCampaignCaptions();

  return <CaptionManagementView initialCaptions={captions} />;
}

