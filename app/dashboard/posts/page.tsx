import { formatMetric } from "@/lib/utils";
import { ExternalLink, Heart, MessageCircle, Eye } from "lucide-react";

const samplePosts = [
  {
    id: "p-1",
    handle: "volunteer_alice",
    url: "https://www.instagram.com/p/DB9xyz123AB/",
    caption: "Excited to share our community volunteer updates for the month! #community #service",
    mediaType: "Image",
    postedAt: "2026-11-03 10:15",
    likes: 142,
    comments: 18,
    views: null, // null for photo post -> displayed as n/a
  },
  {
    id: "p-2",
    handle: "volunteer_alice",
    url: "https://www.instagram.com/p/DB9xyz123AC/",
    caption: "Recap reel of yesterday's city clean-up drive. Huge thanks to everyone who joined!",
    mediaType: "Video",
    postedAt: "2026-11-02 14:30",
    likes: null, // null for hidden likes -> displayed as n/a
    comments: 45,
    views: 1890,
  },
  {
    id: "p-3",
    handle: "volunteer_bob",
    url: "https://www.instagram.com/p/DB9xyz123AD/",
    caption: "Photo carousel from the youth mentorship workshop. Inspiring day!",
    mediaType: "Sidecar",
    postedAt: "2026-11-01 08:00",
    likes: 89,
    comments: 0,
    views: null,
  },
];

export default function PostsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Recent Monitored Posts
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Posts published within the last 30-day tracking window (up to 10 per account).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Account</th>
                <th className="px-6 py-3">Caption</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Posted Date</th>
                <th className="px-6 py-3 text-right">Likes</th>
                <th className="px-6 py-3 text-right">Comments</th>
                <th className="px-6 py-3 text-right">Views</th>
                <th className="px-6 py-3 text-right">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {samplePosts.map((post) => (
                <tr key={post.id} className="hover:bg-slate-50 transition">
                  <td className="px-6 py-4 font-semibold text-blue-600">@{post.handle}</td>
                  <td className="px-6 py-4 text-slate-700 max-w-xs truncate" title={post.caption}>
                    {post.caption}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-medium text-slate-600">
                      {post.mediaType}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500">{post.postedAt}</td>
                  <td className="px-6 py-4 text-right font-medium">
                    <span className="inline-flex items-center gap-1 text-rose-600">
                      <Heart className="h-3.5 w-3.5" />
                      {formatMetric(post.likes)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-medium">
                    <span className="inline-flex items-center gap-1 text-teal-600">
                      <MessageCircle className="h-3.5 w-3.5" />
                      {formatMetric(post.comments)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-medium">
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <Eye className="h-3.5 w-3.5" />
                      {formatMetric(post.views)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

