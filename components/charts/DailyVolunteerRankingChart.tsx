"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

export interface VolunteerRankingPoint {
  date: string;
  rank: number; // 1 = top performer
}

export function DailyVolunteerRankingChart({ data }: { data: VolunteerRankingPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        No ranking data available yet.
      </div>
    );
  }

  const maxRank = Math.max(...data.map((d) => d.rank));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          {/* Reversed: rank 1 is best so appears at top */}
          <YAxis
            reversed
            domain={[1, maxRank + 1]}
            tickCount={maxRank + 1}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `#${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              fontSize: "12px",
            }}
            formatter={(value: number) => [`#${value}`, "Daily Rank"]}
          />
          {/* Highlight rank #1 line */}
          <ReferenceLine y={1} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: "Top", fill: "#10b981", fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="rank"
            stroke="#3b82f6"
            strokeWidth={2.5}
            dot={{ fill: "#3b82f6", r: 4, strokeWidth: 2, stroke: "#fff" }}
            activeDot={{ r: 6, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }}
            name="Rank"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
