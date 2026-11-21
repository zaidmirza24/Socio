import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** One or two plain sentences: what this page shows and what to do here. */
  description?: ReactNode;
  /** Small count/status chip next to the title. */
  badge?: ReactNode;
  /** Right-aligned primary actions. */
  actions?: ReactNode;
  /** Filters/controls rendered under the title. */
  children?: ReactNode;
}

/** The single page heading used on every dashboard page (the only <h1> on the page). */
export function PageHeader({ title, description, badge, actions, children }: PageHeaderProps) {
  return (
    <div className="space-y-4 border-b border-slate-200/80 pb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
            {badge && (
              <span className="rounded-full border border-blue-200/60 bg-blue-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-blue-700">
                {badge}
              </span>
            )}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
