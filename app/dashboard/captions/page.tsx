import Link from "next/link";
import { FileText } from "lucide-react";
import { getCampaignCaptions } from "@/lib/supabase/captions";
import { getFeatureSettings } from "@/lib/services/settings";
import { CaptionManagementView } from "@/components/captions/CaptionManagementView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CaptionsPage() {
  const { campaign_captions_enabled } = await getFeatureSettings();

  if (!campaign_captions_enabled) {
    return (
      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-2">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <FileText className="h-5 w-5 text-slate-500" />
          Campaign Captions is turned off
        </h1>
        <p className="text-sm text-slate-500">
          An administrator can turn this feature back on in{" "}
          <Link href="/dashboard/settings" className="text-blue-600 hover:underline">
            Settings
          </Link>
          .
        </p>
      </div>
    );
  }

  const captions = await getCampaignCaptions();

  return <CaptionManagementView initialCaptions={captions} />;
}
