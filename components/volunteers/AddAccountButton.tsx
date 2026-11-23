"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { platformLabel } from "@/lib/platform";

type Platform = "instagram" | "facebook" | "x";

const ALL_PLATFORMS: Platform[] = ["instagram", "facebook", "x"];

interface AddAccountButtonProps {
  volunteerId: string;
  /** Platforms this volunteer already has an account on. */
  existingPlatforms: string[];
}

/** Lets an admin attach a missed social account to an existing volunteer. */
export function AddAccountButton({ volunteerId, existingPlatforms }: AddAccountButtonProps) {
  const router = useRouter();
  const missing = ALL_PLATFORMS.filter((p) => !existingPlatforms.includes(p));
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>(missing[0] ?? "instagram");
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (missing.length === 0) return null;

  const close = () => {
    setOpen(false);
    setHandle("");
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volunteer_id: volunteerId, platform, handle }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not add the account.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setPlatform(missing[0]);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Add account
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <select
        value={platform}
        onChange={(e) => setPlatform(e.target.value as Platform)}
        aria-label="Platform"
        className="text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {missing.map((p) => (
          <option key={p} value={p}>
            {platformLabel(p)}
          </option>
        ))}
      </select>
      <input
        autoFocus
        required
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        placeholder="@handle"
        aria-label="Handle"
        className="w-40 text-xs font-mono rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={saving || handle.trim() === ""}
        className="text-xs font-semibold rounded-lg bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={close} aria-label="Cancel" className="p-1 text-slate-500 hover:text-slate-800">
        <X className="h-4 w-4" />
      </button>
      {error && <span className="w-full text-xs text-rose-600">{error}</span>}
    </form>
  );
}
