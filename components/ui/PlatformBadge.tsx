import { Facebook, Instagram, Twitter } from "lucide-react";
import { platformLabel } from "@/lib/platform";

const STYLES: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-[#e7f0fe] text-[#1877f2] border-[#c5dafc]",
  x: "bg-slate-900 text-white border-slate-700",
};

export function PlatformBadge({ platform, compact = false }: { platform: string; compact?: boolean }) {
  const Icon = platform === "facebook" ? Facebook : platform === "x" ? Twitter : Instagram;
  const style = STYLES[platform] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${style}`}
      title={platformLabel(platform)}
    >
      <Icon className="h-3 w-3" />
      {!compact && platformLabel(platform)}
    </span>
  );
}
