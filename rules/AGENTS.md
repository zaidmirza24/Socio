# Project Architecture & Agent Coding Standards

## 1. Core Principles
- **TypeScript Strict Mode**: Zero `any` types. Strict null checks enabled. All interfaces, API contracts, database models, and component props must have explicit typings.
- **Zod Validation**: Validate all incoming data at application boundaries—specifically Apify webhook payloads, API request bodies, query parameters, and environment variables.
- **No Secrets in Frontend Code**: Never expose API keys, Apify API tokens, Supabase service-role keys, or webhook secrets in client-side code or browser bundles. Frontend components must only access public environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and communicate with protected Next.js API routes or authenticated Supabase client sessions.
- **Strict Environment Validation**: Use `.env.local` with strict environment variable validation schemas (`env.ts` or `env.mjs`) to guarantee runtime safety.
- **Upsert, Never Insert**: All ingestion pipelines must be strictly idempotent. Rerunning a collection task or receiving duplicate webhook deliveries for the same day or same posts must update existing records or ignore duplicates without failing or inflating counts.
- **Forbidden Automation & Hosting**:
  - DO NOT use Netlify Cron Jobs, Vercel Cron Jobs, Next.js scheduled functions, or external cron services. Apify Schedules is the single authoritative daily automation engine.
  - DO NOT configure local-only hosting, VPNs, or Tailscale tunnels for production access. Production hosting is on Vercel, accessible across different networks and locations via private, login-protected authentication (Supabase Auth).

---

## 2. Data Ingestion & Collector Rules
- **Scope (Initial Version)**:
  - Instagram only (30 active accounts, up to 10 recent posts per account).
  - Facebook scraping is postponed until a later phase.
- **Daily Automation Workflow**:
  1. Apify Schedule triggers the Instagram scraping Task daily at 8:00 AM IST (02:30 UTC).
  2. The scraper collects up to 10 recent posts from each active account.
  3. When the Apify run succeeds, Apify sends a webhook POST request to our Next.js API endpoint (`/api/webhooks/apify`).
  4. The webhook endpoint validates the request using a secure webhook secret / signature verification (`APIFY_WEBHOOK_SECRET`) and retrieves the completed dataset using the server-side Apify client.
  5. The application processes and normalizes the collected information via the Instagram adapter (`lib/collectors/instagram.ts`).
  6. New posts are inserted without duplicates (`ON CONFLICT (platform, platform_post_id) DO UPDATE`).
  7. Existing posts are updated with fresh metadata.
  8. Daily engagement snapshots are saved in Supabase (`ON CONFLICT (post_id, snapshot_date) DO UPDATE`).
  9. The dashboard displays updated information.
- **Adapter Pattern**:
  - Direct vendor API schemas (e.g., Apify Instagram actor output) must never leak into dashboard UI or core business logic.
  - All collectors must map raw data into standardized domain models via dedicated adapters (`lib/collectors/instagram.ts`).
- **Metric Integrity**:
  - If a metric is hidden, unavailable, or unsupported on a platform (e.g. Instagram shares or private likes), record it as `null`.
  - **Never default unavailable metrics to `0`**; `0` means zero engagements occurred, whereas `null` represents unmeasured/hidden. The UI displays `"n/a"` for `null`.
- **Active Post Tracking Window**:
  - Daily scraper collects up to 10 recent posts per active account to capture new posts and refresh ongoing engagement.
  - Posts older than 30 days are frozen to manage vendor costs.
- **Audit Logging & Error Handling**:
  - Every scrape or webhook processing event must record an entry in `collection_runs` with start time, completed time, status (`success`, `failed`, `partial`), posts count, and structured error payloads.
  - Failed runs must be logged and handled gracefully without breaking the ingestion pipeline.

---

## 3. Database & SQL Rules (Supabase Postgres)
- **Core Tables**:
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
  - Hosted on Vercel with serverless compute and edge routing.
  - Accessible to authorized team members through a private, login-protected application URL.
  - Multiple team members can access the application from different networks and locations over standard HTTPS.
- **Authentication**:
  - Team authentication powered by Supabase Auth (email/password or magic links).
  - Next.js middleware guards all dashboard pages and protected API endpoints.
  - Row Level Security (RLS) enabled on all database tables.

---

## 5. Testing & Verification Workflow
- **Fixtures First**: Develop collector adapters and parsers against static JSON fixtures before connecting live APIs.
- **Idempotency Tests**: Always verify that running the ingestion pipeline twice on identical input data yields zero duplicate rows and exactly one snapshot per post per date.
- **One Vertical Slice Per Task**: Build iteratively (schema & migrations -> adapter & unit test -> ingestion webhook -> SQL views -> dashboard pages).
