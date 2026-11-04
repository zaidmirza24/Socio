# Social Media Monitoring System Specification

## 1. Overview
An automated social media monitoring system built with Next.js (App Router, TypeScript) and Supabase Postgres that tracks Instagram engagement daily, stores complete time-series history, and visualizes it in an authenticated team dashboard.

The application is hosted on Vercel and accessible across different networks and locations via private, login-protected authentication.

### Project Scope (Initial Phase)
- **Platform**: Instagram only (Facebook is postponed until a later phase).
- **Accounts**: 30 active volunteer accounts.
- **Post Window**: Up to 10 recent posts per active account.
- **Daily Engagement Monitoring**: Automated point-in-time snapshot collection.
- **Historical Engagement Tracking**: Day-over-day and rolling trend analysis.
- **Volunteer Rankings**: Top and bottom performers, leaderboards, and comparative metrics.
- **Analytics Dashboard**: Multi-view analytics with Recharts visualizations.
- **Team Authentication**: Login-protected application access via Supabase Auth.
- **System Health Monitoring**: Run audit logs, failed run alerts, and snapshot completeness tracking.

---

## 2. Technology Stack

| Layer | Technology | Role & Rationale |
|---|---|---|
| **App Framework** | Next.js 14+ (App Router, TypeScript) | Unified dashboard, server components, and secure webhook handler in one codebase |
| **UI Components & Styling** | Tailwind CSS + shadcn/ui + Lucide Icons | Clean modern aesthetic, responsive design, and accessible components |
| **Data Visualization** | Recharts | Composable React charting for time-series and comparative metrics |
| **Database** | Supabase PostgreSQL | Relational time-series store, unique constraints, and SQL aggregation views |
| **Authentication** | Supabase Auth | Team member authentication, session management, and Row Level Security (RLS) |
| **Data Collection** | Apify Instagram Scraper | Handles anti-bot bypass, residential proxies, and post/profile scraping |
| **Daily Automation** | Apify Schedules | Standalone daily scheduler running at 8:00 AM IST; zero server-side cron dependencies |
| **Data Handoff** | Apify Webhooks | Event-driven push notifications dispatched to Next.js API upon run completion |
| **Hosting & Deployment** | Vercel | Global edge routing, HTTPS, serverless execution, and zero local-network dependencies |

---

## 3. Hosting & Network Requirements

- **Production Hosting**: Hosted entirely on Vercel.
- **Multi-Network Team Access**: Authorized team members must be able to securely access the application from different networks and locations over standard HTTPS.
- **Access Control**: Application URL is private and login-protected. Next.js middleware intercepts unauthenticated requests and redirects to the login screen.
- **Deprecated / Forbidden Approaches**:
  - No local hosting or localhost servers.
  - No VPN or Tailscale tunneling requirements for access.
  - No Netlify Cron Jobs, Vercel Cron Jobs, Next.js scheduled functions, or external cron services.

---

## 4. Daily Automation & Ingestion Workflow

Daily scraping is managed independently by **Apify Schedules**. No server cron triggers or polling loops exist on our application server.

```
+-------------------------------------------------------------------------------+
| 1. Apify Schedule triggers Instagram Scraping Task daily at 8:00 AM IST       |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 2. Apify Actor scrapes up to 10 recent posts for each active account (30 accts)|
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 3. On run completion, Apify dispatches webhook POST to /api/webhooks/apify     |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 4. Next.js Webhook validates signature/secret & fetches dataset via Apify API |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 5. Adapter normalizes vendor schema into domain models (lib/collectors)       |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 6. Posts upserted: new posts inserted, existing post metadata updated         |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 7. Daily engagement snapshots saved to post_snapshots & account_snapshots     |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 8. Audit log recorded in collection_runs (status, counts, error details)      |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| 9. Dashboard reflects updated metrics, rankings, and deltas                  |
+-------------------------------------------------------------------------------+
```

### Detailed Workflow Steps
1. **Schedule Execution**: At 8:00 AM IST (02:30 UTC), Apify Schedules triggers the configured Apify Instagram Scraping Task.
2. **Data Collection**: The actor fetches the latest 10 posts from each active account.
3. **Webhook Dispatch**: When the actor run completes (`SUCCEEDED` or `FAILED`), Apify sends an HTTP POST request to `https://<domain>/api/webhooks/apify`.
4. **Validation & Dataset Retrieval**:
   - The endpoint validates the webhook secret / signature (`APIFY_WEBHOOK_SECRET`).
   - For successful runs, the handler fetches the dataset records using the Apify server-side SDK/REST API (`APIFY_API_TOKEN`).
5. **Data Normalization**: `lib/collectors/instagram.ts` transforms raw vendor objects into standardized domain objects.
6. **Post Upsert**: Monitored posts are upserted into the `posts` table using `ON CONFLICT (platform, platform_post_id) DO UPDATE`.
7. **Snapshot Upsert**: Engagement snapshots for the current snapshot date are saved into `post_snapshots` and `account_snapshots` using `ON CONFLICT DO UPDATE`.
8. **Run Audit Logging**: Execution details (start time, end time, post count, status, errors) are recorded in `collection_runs`.
9. **Dashboard Presentation**: Authenticated team members view freshly updated charts, deltas, and volunteer leaderboards.

### Error Handling & Reliability
- **Failed Runs**: If the Apify actor fails, the webhook captures the failure payload and logs the error in `collection_runs` with status `failed`.
- **Webhook Retries**: All database writes are idempotent. If Apify re-delivers a webhook, existing posts and snapshots are updated in place without duplicate records or inflated numbers.
- **Secret Isolation**: `APIFY_API_TOKEN`, `APIFY_WEBHOOK_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` reside exclusively in server-side environment variables and are never bundled into client JavaScript.

---

## 5. Database Schema & Constraints

The database is built on Supabase PostgreSQL with strict unique constraints and foreign keys across 6 core tables:

### 1. `accounts`
Stores social media accounts monitored by the system.
- `id` (UUID, Primary Key)
- `platform` (`text`, check constraint: `'instagram' | 'facebook'`, default `'instagram'`)
- `handle` (`text`, unique per platform)
- `volunteer_name` (`text`)
- `status` (`text`, check constraint: `'active' | 'paused' | 'archived'`, default `'active'`)
- `added_at` (`timestamptz`, default `now()`)
- `updated_at` (`timestamptz`, default `now()`)

### 2. `posts`
Stores individual posts discovered from monitored accounts.
- `id` (UUID, Primary Key)
- `account_id` (UUID, references `accounts(id)` on delete cascade)
- `platform` (`text`)
- `platform_post_id` (`text`)
- `url` (`text`)
- `caption` (`text`, nullable)
- `media_type` (`text`, nullable)
- `posted_at` (`timestamptz`)
- `first_seen_at` (`timestamptz`, default `now()`)
- `last_seen_at` (`timestamptz`, default `now()`)
- **Constraint**: `UNIQUE(platform, platform_post_id)`

### 3. `post_snapshots`
Daily point-in-time metrics for every tracked post.
- `id` (UUID, Primary Key)
- `post_id` (UUID, references `posts(id)` on delete cascade)
- `snapshot_date` (`date`, default `CURRENT_DATE`)
- `likes` (`integer`, nullable)
- `comments` (`integer`, nullable)
- `shares` (`integer`, nullable)
- `views` (`integer`, nullable)
- `raw_json` (`jsonb`, nullable)
- `created_at` (`timestamptz`, default `now()`)
- **Constraint**: `UNIQUE(post_id, snapshot_date)`

### 4. `account_snapshots`
Daily account-level summary metrics.
- `id` (UUID, Primary Key)
- `account_id` (UUID, references `accounts(id)` on delete cascade)
- `snapshot_date` (`date`, default `CURRENT_DATE`)
- `followers` (`integer`, nullable)
- `following` (`integer`, nullable)
- `post_count` (`integer`, nullable)
- `created_at` (`timestamptz`, default `now()`)
- **Constraint**: `UNIQUE(account_id, snapshot_date)`

### 5. `collection_runs`
Audit ledger tracking every scraping and ingestion event.
- `id` (UUID, Primary Key)
- `actor_run_id` (`text`, nullable)
- `platform` (`text`, default `'instagram'`)
- `started_at` (`timestamptz`)
- `completed_at` (`timestamptz`, nullable)
- `status` (`text`, check constraint: `'started' | 'success' | 'failed' | 'partial'`)
- `accounts_targeted` (`integer`, default 0)
- `posts_found` (`integer`, default 0)
- `posts_upserted` (`integer`, default 0)
- `snapshots_created` (`integer`, default 0)
- `error` (`jsonb`, nullable)

### 6. `profiles`
Team member accounts linked to Supabase Auth.
- `id` (UUID, Primary Key, references `auth.users(id)` on delete cascade)
- `email` (`text`, unique)
- `full_name` (`text`, nullable)
- `role` (`text`, check constraint: `'admin' | 'member'`, default `'member'`)
- `created_at` (`timestamptz`, default `now()`)

---

## 6. Metric Integrity Rules

- **Distinguish Zero from Missing**:
  - If a metric is hidden, unmeasured, or unsupported on Instagram (e.g., share counts or private like counts), store it as `null`.
  - Never default unavailable metrics to `0`. A value of `0` denotes an engagement metric that was explicitly zero, whereas `null` denotes missing or private information.
- **Frontend Presentation**:
  - The UI displays `"n/a"` for `null` metrics, preventing misleading calculations or false zero-engagement indicators.

---

## 7. Implementation Roadmap

### Phase 0: Setup & Configuration
- Initialize Next.js 14+ App Router project with TypeScript, Tailwind CSS, and shadcn/ui.
- Establish strict environment variable schemas (`env.ts`) validating Apify and Supabase credentials.
- Configure Supabase client utilities (server client with service-role, client-side browser client).
- Configure Apify SDK and webhook secret validation utilities.

### Phase 1: Database Schema & Authentication
- Supabase migrations for the 6 core tables: `accounts`, `posts`, `post_snapshots`, `account_snapshots`, `collection_runs`, `profiles`.
- Apply unique constraints and indexes for high-speed snapshot lookups.
- Configure Supabase Auth and Next.js middleware for login-protected routes.
- Seed database with the initial 30 volunteer Instagram accounts.

### Phase 2: Ingestion Adapter & Webhook Pipeline
- Static JSON test fixtures matching Apify Instagram actor output.
- Ingestion adapter (`lib/collectors/instagram.ts`) with strict Zod validation and metric normalization.
- Webhook route handler (`/api/webhooks/apify`) verifying signatures and triggering dataset ingestion.
- Idempotency verification tests: ensure repeated deliveries for the same date yield zero duplicate rows.
- Structured run logging in `collection_runs`.

### Phase 3: SQL Metrics & Views Layer
- SQL views / functions for:
  - Day-over-day deltas (today vs yesterday).
  - 7-day and 30-day engagement trends.
  - Volunteer rankings and performance leaderboards.
  - Trend classifications (gaining, steady, declining).

### Phase 4: Authenticated Team Dashboard
- Login and session management UI.
- Overview Page: High-level KPI cards and aggregated engagement trend charts (Recharts).
- Accounts Page: Volunteer rankings, account-level performance, top/bottom gainers.
- Posts Page: Top posts, viral gainers, and individual post history drilldown.
- Filters: Date range picker and account selector.

### Phase 5: System Health Monitoring
- System health dashboard visualizing `collection_runs`.
- Run status indicator (last successful run, duration, post counts).
- Anomaly detector: accounts missing snapshots on target dates or unexpected failure rates.

### Phase 6: Account Management & Apify Sync
- Admin interface to manage volunteer accounts (add, pause, archive).
- Synchronize active account handles to Apify Task input via Apify REST API.

### Phase 7: Production Hardening & Vercel Deployment
- Deploy to Vercel with environment variable configuration.
- Connect Apify Schedule (8:00 AM IST) and register production webhook URL on Apify.
- End-to-end verification of scheduled run, webhook delivery, and dashboard updates.

### Phase 8: Scaling & Facebook Adapter (Future Phase)
- Implement `lib/collectors/facebook.ts` for Facebook post collection.
- Scale account capacity beyond the initial 30 accounts.
