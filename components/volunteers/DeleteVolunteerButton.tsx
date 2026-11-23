"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface Props {
  volunteerId: string;
  name: string;
}

/**
 * Deletes a volunteer. Deleting their collected data is an explicit, separate choice, and the safe
 * option (keep the data) is the default.
 */
export function DeleteVolunteerButton({ volunteerId, name }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setDeleteData(false); // never carry a "delete data" choice over to the next volunteer
    setError(null);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/volunteers?id=${encodeURIComponent(volunteerId)}&deleteData=${deleteData}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not delete the volunteer. Please try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const option =
    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-left has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Delete volunteer"
        aria-label={`Delete ${name}`}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <ConfirmDialog
        open={open}
        title={`Delete ${name}?`}
        confirmLabel={deleteData ? "Delete volunteer and data" : "Delete volunteer"}
        danger
        busy={busy}
        onConfirm={confirm}
        onCancel={close}
      >
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-2">What should happen to the posts and engagement history collected for them?</legend>
          <label className={option}>
            <input type="radio" name="delete-data" checked={!deleteData} onChange={() => setDeleteData(false)} className="mt-0.5" />
            <span>
              <strong className="block text-slate-900">Keep their data</strong>
              Their accounts are archived (no longer collected) and stay on the dashboards.
            </span>
          </label>
          <label className={option}>
            <input type="radio" name="delete-data" checked={deleteData} onChange={() => setDeleteData(true)} className="mt-0.5" />
            <span>
              <strong className="block text-red-700">Delete their data too</strong>
              Accounts, posts and all engagement history are removed. This can&apos;t be undone.
            </span>
          </label>
        </fieldset>
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
