"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, Loader2 } from "lucide-react";
import type { DateRangePreset } from "@/lib/supabase/queries";

export interface DateRangeOption {
  id: DateRangePreset;
  label: string;
  description?: string;
}

export const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { id: "today", label: "Today", description: "Activity recorded today" },
  { id: "7d", label: "7 Days", description: "Past 7 days" },
  { id: "30d", label: "Month Before", description: "Past 30 days" },
  { id: "180d", label: "6 Months Before", description: "Past 180 days" },
];

export interface DateRangeFilterProps {
  value?: DateRangePreset;
  onChange?: (preset: DateRangePreset) => void;
  showAllOption?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function DateRangeFilter({
  value,
  onChange,
  showAllOption = true,
  className = "",
  size = "md",
}: DateRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // If no controlled value, read from searchParams, defaulting to "30d"
  const currentParam = (searchParams?.get("range") as DateRangePreset) || "30d";
  const activePreset: DateRangePreset = value ?? currentParam;

  const options: DateRangeOption[] = showAllOption
    ? [...DATE_RANGE_OPTIONS, { id: "all", label: "All Time", description: "All recorded history" }]
    : DATE_RANGE_OPTIONS;

  const handleSelect = (preset: DateRangePreset) => {
    if (preset === activePreset && !isPending) return;

    if (onChange) {
      onChange(preset);
    } else {
      startTransition(() => {
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("range", preset);
        router.push(`${pathname}?${params.toString()}`);
      });
    }
  };

  const isSmall = size === "sm";

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/90 p-1 shadow-2xs backdrop-blur-xs ${className}`}
      role="group"
      aria-label="Date Range Filter"
    >
      <div className="flex items-center gap-1.5 pl-2 pr-1 text-slate-400">
        {isPending ? (
          <Loader2 className={`${isSmall ? "h-3.5 w-3.5" : "h-4 w-4"} animate-spin text-blue-600`} />
        ) : (
          <Calendar className={`${isSmall ? "h-3.5 w-3.5" : "h-4 w-4"} text-slate-500`} />
        )}
        <span className="hidden sm:inline text-xs font-medium text-slate-500">Filter:</span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {options.map((opt) => {
          const isActive = activePreset === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              disabled={isPending}
              title={opt.description}
              className={`relative inline-flex items-center justify-center rounded-lg transition-all cursor-pointer font-medium disabled:opacity-70 ${
                isSmall ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs sm:text-sm"
              } ${
                isActive
                  ? "bg-white text-blue-600 font-semibold shadow-xs border border-slate-200/80 ring-1 ring-blue-500/20"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
              }`}
            >
              {opt.label}
              {isActive && (
                <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-blue-600" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

