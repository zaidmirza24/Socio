import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md p-10 pt-[20vh] text-center">
      <h1 className="text-xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-1 text-sm text-slate-600">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/dashboard" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
        Go to Dashboard
      </Link>
    </div>
  );
}
