# Project Architecture & Agent Coding Standards

## 1. Core Principles
- **TypeScript Strict Mode**: Zero `any` types. Strict null checks enabled. All interfaces, API contracts, database models, and component props must have explicit typings.
- **Zod Validation**: Validate all incoming data at application boundaries—specifically Apify webhook payloads, API request bodies, query parameters, and environment variables.
- **No Secrets in Frontend Code**: Never expose API keys, Apify API tokens, Supabase service-role keys, or webhook secrets in client-side code or browser bundles. Frontend components must only access public environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and communicate with protected Next.js API routes or authenticated Supabase client sessions.
- **Strict Environment Validation**: Use `.env.local` with strict environment variable validation schemas (`env.ts` or `env.mjs`) to guarantee runtime safety.
- **Upsert, Never Insert**: All ingestion pipelines must be strictly idempotent. Rerunning a collection task or receiving duplicate webhook deliveries for the same day or same posts must update existing records or ignore duplicates without failing or inflating counts.
- **Forbidden Automation & Hosting**:
  - DO NOT use Netlify Cron Jobs, Vercel Cron Jobs, Next.js scheduled functions, or external cron services.
  - Collection is **admin-triggered**: the admin clicks "Run all platforms" (or one platform) in the app each day. There is no Apify Schedule and no webhook; the app polls the run status and ingests the dataset itself (`/api/scraper/status` -> `ingestCompletedJob`).
  - The scraper is run from the admin's own (locally run) copy of the app against the shared Supabase project. DO NOT configure VPNs or Tailscale tunnels. Team members view the dashboard through login-protected Supabase Auth.

---

## 2. Data Ingestion & Collector Rules
- **Scope**:
  - Instagram, Facebook and X. About 500-600 volunteers; one volunteer has up to 3 accounts (one per platform). Facebook and X are switched on in Settings.
  - Campaign length is roughly 5-6 months.
- **Daily Workflow (admin-triggered)**:
  1. The admin runs the scraper ("Run all platforms" or per platform). Discovery collects only posts made **today (IST)**, capped per account per day (`discovery_post_limit`, Settings; 6-8 typical).
  2. The app polls the Apify run; when it finishes, `ingestCompletedJob` fetches the dataset with the server-side Apify client.
  3. Platform adapters (`lib/scrapers/**`) normalize raw data into domain models.
  4. Every post is stored (`ON CONFLICT (platform, platform_post_id) DO UPDATE`) with a daily engagement snapshot (`ON CONFLICT (post_id, snapshot_date) DO UPDATE`). Nothing is discarded.
  5. If the caption filter is ON, each post is labelled `matched` / `needs_review` / `unmatched` (`posts.match_status`). Exact matches also go to `matched_posts`; fuzzy matches go to the review queue. If OFF, no matching is done.
  6. Turning the filter ON, or changing captions, labels already-stored posts (`lib/services/match-stored-posts.ts`). Stored posts keep being refreshed (engagement) in both states.
  7. The dashboard shows every post and its engagement over time; "Campaign posts only" is an optional view, never a deletion.
- **Caption filter**: OFF early (content sent without captions) so all posts are kept; ON later to identify posts that carry the supplied captions.
- **Adapter Pattern**:
  - Direct vendor API schemas (e.g., Apify Instagram actor output) must never leak into dashboard UI or core business logic.
  - All collectors must map raw data into standardized domain models via dedicated adapters (`lib/scrapers/apify/adapter.ts` for Instagram, `lib/scrapers/facebook/adapter.ts`, `lib/scrapers/twitter/adapter.ts`; registry in `lib/scrapers/platform-adapter.ts`).
- **Metric Integrity**:
  - If a metric is hidden, unavailable, or unsupported on a platform (e.g. Instagram shares or private likes), record it as `null`.
  - **Never default unavailable metrics to `0`**; `0` means zero engagements occurred, whereas `null` represents unmeasured/hidden. The UI displays `"n/a"` for `null`.
- **Active Post Tracking Window**:
  - Daily discovery collects today's posts (IST) per active account, up to the configured cap.
  - Older stored posts are refreshed by the admin-run engagement refresh (default every 7 days). Posts older than the cutoff (default 30 days) are frozen to manage vendor costs.
- **Audit Logging & Error Handling**:
  - Every scrape or webhook processing event must record an entry in `collection_runs` with start time, completed time, status (`success`, `failed`, `partial`), posts count, and structured error payloads.
  - Failed runs must be logged and handled gracefully without breaking the ingestion pipeline.

---

## 3. Database & SQL Rules (Supabase Postgres)
- **Core Tables**:
  - `volunteers`: The person. One volunteer owns up to 3 `accounts` (one per platform); `volunteer_totals` is the cross-platform roll-up view.
  - `accounts`: Monitored volunteer social media accounts.
  - `posts`: Monitored post items across platforms.
  - `post_snapshots`: Daily point-in-time engagement records per post.
  - `account_snapshots`: Daily account-level metrics (followers, following, post counts).
  - `collection_runs`: Audit log tracking ingestion status, posts upserted, and errors.
  - `profiles`: Application team members and roles linked to Supabase `auth.users(id)`.
- **Strict Unique Constraints & Idempotency**:
  - `posts`: `UNIQUE(platform, platform_post_id)`
  - `post_snapshots`: `UNIQUE(post_id, snapshot_date)`
  - `account_snapshots`: `UNIQUE(account_id, snapshot_date)`
  - `profiles`: `id` references `auth.users(id)`
  - Webhook retries and backfills must use idempotent `ON CONFLICT` upserts so duplicate rows are never created.
- **Aggregation in SQL**:
  - Keep complex time-series deltas, growth rates, rolling averages, and classifications (gaining vs declining) in SQL views or functions to maintain high UI performance and clean client logic.

---

## 4. Authentication & Hosting Rules
- **Hosting**:
  - The scraper is run from the admin's locally run app (see section 1). The dashboard may be deployed (e.g. Vercel) behind Supabase Auth for the wider team.
  - Any deployed copy must stay login-protected; there are no cron jobs or webhooks to configure.
  - The first admin is the first user created in Supabase Auth (trigger), or via `/api/admin/users` with the `BOOTSTRAP_TOKEN` header.
- **Authentication**:
  - Team authentication powered by Supabase Auth (email/password or magic links).
  - Next.js middleware guards all dashboard pages and protected API endpoints.
  - Row Level Security (RLS) enabled on all database tables.

---

## 5. Testing & Verification Workflow
- **Fixtures First**: Develop collector adapters and parsers against static JSON fixtures before connecting live APIs.
- **Idempotency Tests**: Always verify that running the ingestion pipeline twice on identical input data yields zero duplicate rows and exactly one snapshot per post per date.
- **One Vertical Slice Per Task**: Build iteratively (schema & migrations -> adapter & unit test -> ingestion webhook -> SQL views -> dashboard pages).
