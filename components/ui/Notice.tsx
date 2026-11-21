import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type NoticeTone = "success" | "error" | "info";

const STYLES: Record<NoticeTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info } as const;

interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** Inline message that replaces browser alert(). Errors are announced immediately. */
export function Notice({ tone, children, onDismiss, className = "" }: NoticeProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${STYLES[tone]} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
