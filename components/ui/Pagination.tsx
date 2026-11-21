import Link from "next/link";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the URL for a given page number. */
  hrefFor: (page: number) => string;
}

const base = "rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium";

/** Footer for server-rendered tables: "1–50 of 230", Previous / Next. */
export function Pagination({ page, pageSize, total, hrefFor }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-600"
    >
      <span>
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-2">
        {current > 1 ? (
          <Link href={hrefFor(current - 1)} className={`${base} text-slate-700 hover:bg-slate-50`}>
            Previous
          </Link>
        ) : (
          <span className={`${base} text-slate-300`} aria-disabled="true">
            Previous
          </span>
        )}
        <span>
          Page {current} of {totalPages}
        </span>
        {current < totalPages ? (
          <Link href={hrefFor(current + 1)} className={`${base} text-slate-700 hover:bg-slate-50`}>
            Next
          </Link>
        ) : (
          <span className={`${base} text-slate-300`} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
