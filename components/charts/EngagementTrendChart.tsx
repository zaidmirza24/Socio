"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export interface TrendDataPoint {
  date: string;
  likes: number;
  comments: number;
}

interface EngagementTrendChartProps {
  data: TrendDataPoint[];
}

export function EngagementTrendChart({ data }: EngagementTrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        No engagement trend data available yet.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="likesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="commentsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 12 }} stroke="#cbd5e1" />
          <YAxis tick={{ fill: "#64748b", fontSize: 12 }} stroke="#cbd5e1" />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
              fontSize: "12px",
            }}
          />
          <Area
            type="monotone"
            dataKey="likes"
            stroke="#3b82f6"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#likesGradient)"
            name="Likes"
          />
          <Area
            type="monotone"
            dataKey="comments"
            stroke="#10b981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#commentsGradient)"
            name="Comments"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

