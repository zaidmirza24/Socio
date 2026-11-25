"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export interface VolunteerRankingPoint {
  date: string;
  /** Best-performing volunteer on this day. */
  volunteer: string;
  /** Likes + comments that volunteer gained on this day. */
  engagement: number;
}

interface TooltipPayloadItem {
  payload: VolunteerRankingPoint;
}

function RankingTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-slate-900">{point.date}</div>
      <div className="mt-0.5 text-slate-600">Top: {point.volunteer}</div>
      <div className="text-slate-500">{point.engagement.toLocaleString("en-IN")} engagements gained</div>
    </div>
  );
}

export function DailyVolunteerRankingChart({ data }: { data: VolunteerRankingPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        No engagement recorded in this period yet.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<RankingTooltip />} cursor={{ fill: "#f1f5f9" }} />
          <Bar dataKey="engagement" fill="#E2231A" radius={[4, 4, 0, 0]} name="Engagement" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
