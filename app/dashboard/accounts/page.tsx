import { UserCheck, Shield } from "lucide-react";

// Initial volunteer accounts dataset matching the 30 accounts scope
const initialAccounts = [
  { id: "1", handle: "volunteer_alice", volunteer_name: "Alice Volunteer", status: "active", postsCount: 10, followers: 1250, added_at: "2026-11-01" },
  { id: "2", handle: "volunteer_bob", volunteer_name: "Bob Builder", status: "active", postsCount: 9, followers: 980, added_at: "2026-11-01" },
  { id: "3", handle: "volunteer_charlie", volunteer_name: "Charlie Green", status: "active", postsCount: 8, followers: 750, added_at: "2026-11-01" },
  { id: "4", handle: "volunteer_diana", volunteer_name: "Diana Prince", status: "active", postsCount: 10, followers: 1100, added_at: "2026-11-01" },
  { id: "5", handle: "volunteer_ethan", volunteer_name: "Ethan Hunt", status: "active", postsCount: 10, followers: 820, added_at: "2026-11-01" },
  { id: "6", handle: "volunteer_fiona", volunteer_name: "Fiona Gallagher", status: "active", postsCount: 7, followers: 640, added_at: "2026-11-01" },
  { id: "7", handle: "volunteer_george", volunteer_name: "George Clark", status: "active", postsCount: 10, followers: 910, added_at: "2026-11-01" },
  { id: "8", handle: "volunteer_hannah", volunteer_name: "Hannah Abbott", status: "active", postsCount: 9, followers: 1300, added_at: "2026-11-01" },
  { id: "9", handle: "volunteer_ian", volunteer_name: "Ian Malcolm", status: "active", postsCount: 6, followers: 520, added_at: "2026-11-01" },
  { id: "10", handle: "volunteer_julia", volunteer_name: "Julia Roberts", status: "active", postsCount: 10, followers: 1450, added_at: "2026-11-01" },
];

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Monitored Accounts ({initialAccounts.length} / 30 Active)
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Volunteer Instagram accounts enrolled in daily engagement tracking.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Volunteer Name</th>
                <th className="px-6 py-3">Instagram Handle</th>
                <th className="px-6 py-3">Platform</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Posts Tracked</th>
                <th className="px-6 py-3 text-right">Followers</th>
                <th className="px-6 py-3 text-right">Enrolled Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {initialAccounts.map((account) => (
                <tr key={account.id} className="hover:bg-slate-50 transition">
                  <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-slate-400" />
                    {account.volunteer_name}
                  </td>
                  <td className="px-6 py-4 text-blue-600 font-medium">@{account.handle}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-pink-50 text-pink-700 font-medium border border-pink-200">
                      Instagram
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                      {account.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-medium">{account.postsCount}</td>
                  <td className="px-6 py-4 text-right">{account.followers.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-xs text-slate-400">{account.added_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

