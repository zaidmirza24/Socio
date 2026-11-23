"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { VolunteerOption } from "@/lib/services/volunteer-options";

const PLATFORM_SHORT: Record<VolunteerOption["platforms"][number], string> = { instagram: "IG", facebook: "FB", x: "X" };

export type VolunteerLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; volunteers: VolunteerOption[] };

/** Loads the volunteers a run can cover. Fetches once, the first time `enabled` becomes true. */
export function useVolunteerOptions(enabled: boolean): VolunteerLoadState {
  const [state, setState] = useState<VolunteerLoadState>({ status: "loading" });
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (enabled) setRequested(true);
  }, [enabled]);

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/volunteers", { signal: controller.signal });
        const data: { volunteers?: VolunteerOption[]; error?: string } = await res.json();
        if (!res.ok || !data.volunteers) {
          setState({ status: "error", message: data.error ?? "Could not load volunteers." });
        } else {
          setState({ status: "ready", volunteers: data.volunteers });
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ status: "error", message: "Could not reach the server to load volunteers." });
      }
    })();
    return () => controller.abort();
  }, [requested]);

  return state;
}

interface Props {
  volunteers: VolunteerOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}

/**
 * Pick which volunteers a collection run covers. "Select all" / "Deselect all" act on the
 * volunteers currently shown, so they combine with the search box.
 */
export function RunVolunteerPicker({ volunteers, selected, onChange, disabled }: Props) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? volunteers.filter((v) => v.name.toLowerCase().includes(needle)) : volunteers;
  }, [volunteers, query]);

  const allVisibleSelected = visible.length > 0 && visible.every((v) => selected.has(v.id));
  const anyVisibleSelected = visible.some((v) => selected.has(v.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function setVisible(checked: boolean) {
    const next = new Set(selected);
    for (const v of visible) {
      if (checked) next.add(v.id);
      else next.delete(v.id);
    }
    onChange(next);
  }

  const suffix = query.trim() ? " shown" : "";
  const linkButton =
    "text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-600">
          Volunteers{" "}
          <span className="font-normal text-slate-500">
            · {selected.size} of {volunteers.length} selected
          </span>
        </div>
        <div className="flex gap-3 text-xs font-medium">
          <button type="button" disabled={disabled || allVisibleSelected} onClick={() => setVisible(true)} className={linkButton}>
            Select all{suffix}
          </button>
          <button type="button" disabled={disabled || !anyVisibleSelected} onClick={() => setVisible(false)} className={linkButton}>
            Deselect all{suffix}
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder="Search volunteers"
          aria-label="Search volunteers"
          className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <ul className="mt-2 max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" aria-label="Volunteers">
        {visible.length === 0 ? (
          <li className="px-3 py-3 text-xs text-slate-500">
            {volunteers.length === 0 ? "No volunteers with an active account yet." : "No volunteers match your search."}
          </li>
        ) : (
          visible.map((v) => (
            <li key={v.id}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selected.has(v.id)}
                  disabled={disabled}
                  onChange={() => toggle(v.id)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                <span className="min-w-0 flex-1 truncate text-slate-800">{v.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{v.platforms.map((p) => PLATFORM_SHORT[p]).join(" · ")}</span>
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function VolunteerPickerLoading() {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading volunteers...
    </div>
  );
}
