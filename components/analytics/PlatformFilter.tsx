"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Facebook, Instagram, Layers, Twitter } from "lucide-react";
import type { PlatformFilter as PlatformValue } from "@/lib/supabase/queries";

const OPTIONS: Array<{ id: PlatformValue; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: "all", label: "All", Icon: Layers },
  { id: "instagram", label: "Instagram", Icon: Instagram },
  { id: "facebook", label: "Facebook", Icon: Facebook },
  { id: "x", label: "X", Icon: Twitter },
];

/** URL-driven platform switch (`?platform=`). Resets paging when changed. */
export function PlatformFilter({ value }: { value: PlatformValue }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const select = (id: PlatformValue) => {
    if (id === value) return;
    startTransition(() => {
      const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
      if (id === "all") params.delete("platform");
      else params.set("platform", id);
      params.delete("page");
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div
      className={`inline-flex rounded-xl border border-slate-200 bg-slate-50/90 p-1 text-xs font-medium ${pending ? "opacity-70" : ""} `}
      role="group"
      aria-label="Platform filter"
    >
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => select(id)}
          disabled={pending}
          className={`inline-flex focus:bg-black items-center gap-1 rounded-lg px-2.5 py-1.5 transition ${value === id ? "bg-blue-500 text-white font-semibold  shadow-xs" : "text-slate-600 hover:bg-slate-200 "
            }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
