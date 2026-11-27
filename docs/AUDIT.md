# Socio Codebase Audit

## Fourth pass (2026-11-26/27): dependencies, config and cleanup

Type-check, lint, `npm test` (156 tests) and the production build pass after every batch. No migration is needed for this pass.

> **Correction to the third pass below:** the Apify webhook was later re-added (`app/api/webhooks/apify`, `APIFY_WEBHOOK_SECRET`, middleware exemption). It is optional: it only runs when `APIFY_WEBHOOK_BASE_URL` and `APIFY_WEBHOOK_SECRET` are set, and it authenticates with a constant-time secret check.

### Fixed

| # | Problem | Fix |
|---|---------|-----|
| F1 | **Next.js 14.2.35 had critical advisories**: remote code execution in the Image Optimizer and on Windows hosts, plus Server Action DoS, and more | Upgraded to **Next 15.5.29** (the patched 15.x line) and React 19. `cookies()`, `params` and `searchParams` are async, so `createServerComponentClient()` is now `async` and awaited everywhere |
| F2 | `images.remotePatterns` kept `/_next/image` live and outside the auth middleware, although nothing uses `next/image` | Removed. `npm run dev` binds to `127.0.0.1` so the local admin copy is not reachable from the LAN |
| F3 | Supabase self-signup was open. With "any authenticated user can read" RLS, anyone holding the public anon key could sign up and read everything | Signups disabled in the Supabase dashboard (verified: `/auth/v1/settings` reports `disable_signup: true`). **Keep it off**; team members are created via `/api/admin/users` |
| F4 | A failed `matched_posts` upsert returned before the post was saved to `posts`, so the post was lost | The post and its snapshot are still stored; the run ends `partial` and a retry labels it |
| F5 | Re-importing the accounts list reset `status` to `active`, which reactivated paused or archived accounts | An existing account keeps its status unless the row explicitly asks for a non-active one |
| F6 | Changing a handle to one already in use returned 500, and the volunteer was renamed before the failing update | The account is updated first; a duplicate handle returns 409; the rename runs only after success |
| F7 | Caption server actions took unvalidated arguments (an invalid date crashed with a 500) | Zod schemas at the boundary. `getNearMissPosts(days)` is clamped |
| F8 | The admin check was implemented five different ways | One `checkCaller()` in `lib/supabase/require-admin.ts`; `requireUser` / `requireAdmin` / `verifyAdminCaller` wrap it. **Do not re-implement it** |
| F9 | Raw Postgres messages reached the browser from `admin/users` and the caption and review actions | `internalError` / `logInternal` log the detail and return a generic message. Typed, user-facing errors (schedule, Apify, run-active) still show their text |
| F10 | Two clicks within the few seconds a run takes to start could both pass the "no active run" check and pay for two runs | In-process start lock per platform and job type (`withStartLock`). The second click gets `RunStartingError` (409) |
| F11 | `clean-db` skipped volunteers, the refresh queue and schedules; deleting only schedule rows would leave Apify Schedules firing | Clears volunteers and `refresh_queue`; refuses to run while schedules exist |
| F12 | A volunteer spreadsheet could be committed by accident | `*.xlsx` and `*.xls` are git-ignored |

### Still open

- **Dashboard aggregation in JavaScript** (`lib/supabase/metrics-data.ts`, `lib/metrics/gain.ts`) loads every snapshot of the period in 1000-row pages. It will slow down as the campaign grows. It should become a SQL function, as AGENTS.md §3 requires.
- **No database-level idempotency test** (AGENTS.md §5). The tests cover pure functions; nothing ingests a fixture twice against Postgres.
- **The daily trend reads oddly.** Weekly refresh puts a week of growth on the refresh day, and `Math.max(0, …)` hides drops.
- **Ingestion makes 3–6 round-trips per post.** A run that takes longer than the 15-minute claim can be ingested twice. The data stays correct, but the gain summary is wrong.
- **The start lock is per server process.** Two admins on separate local copies can still race; that needs a database lock row.
- **Remaining `npm audit` items have low real-world risk.** PostCSS is pinned inside Next and only runs at build time on our own CSS. The Zod issue needs huge inputs and is fixed by Zod 4, a separate migration. The `basic-ftp` issue sits under `apify-client` and is only reachable through FTP proxy configs.

## Second pass (2026-11-21): scale and concurrency

These problems only appear at campaign scale (about 1800 accounts and about 100k posts) or when requests overlap. Small test runs do not show them.

Before and after the changes, type-check, lint, every test suite and the production build all pass. **Migration `20261126_security_and_tracking_fixes.sql` must be applied** before deploying this code.

### Fixed

| # | Problem | Fix |
|---|---------|-----|
| S1 | **Self-signup could become admin.** The `handle_new_user` trigger took `role` from `raw_user_meta_data`, which whoever signs up controls | The role is now read from `raw_app_meta_data` (service-role only) and only `admin` or `member` is accepted. The trigger also sets `search_path` and takes an advisory lock for the first admin. `/api/admin/users` writes `app_metadata.role` |
| S2 | Bootstrap token comparison could throw (500) on non-ASCII input. A failed profile count was read as "no users", which turned bootstrap mode on | Uses `safeEqual`. A failed count now refuses the request |
| S3 | **1000-row truncation.** Unpaged reads of active accounts (ingestion skipped posts from accounts past row 1000), refresh candidates (most posts were never refreshed), the review map, volunteer assignment, caption stats and the review queue | All paged with `fetchAllRows`. Large `.in()` lists are split with `chunk` |
| S4 | **The same run could be ingested twice at once.** Polls every 4 seconds overlapped while a large dataset was still saving, and the dataset deleted by one request made the other report FAILED | A request must claim the run first (`status → 'ingesting'`, which can be re-claimed after 15 minutes). The client now chains `setTimeout` calls so polls never overlap |
| S5 | **Runs could stay `started` forever.** A failure reported by Apify or thrown during ingestion was never written. A missing run row made ingestion assume Instagram/discovery. A failed ingestion was reported as success | Every terminal outcome is now written to `collection_runs`. Ingestion refuses a run that has no row. A failed ingestion returns FAILED. Writes to the run-log row are checked |
| S6 | **Duplicate paid runs** from a double-click, two tabs or two admins | A trigger first looks for a run of the same platform and job type that is still `started` or `ingesting` (within 6 hours) and follows that run instead (409 from `/api/scraper/trigger`). A refresh batch that fails to start no longer abandons the batches that did start |
| S7 | **A run started before midnight IST and saved after it lost all its posts,** and the dataset was then deleted | The day window and snapshot date use the run's `started_at`. The per-account daily cap from Settings is now applied |
| S8 | **Review decisions were undone.** The review upsert wrote `status: 'pending'` over existing rows | `status` is no longer included in the upsert. New rows get the column default (`pending`) and existing rows keep the admin's decision |
| S9 | **Rejecting a review deleted the post and its history.** Approving left the post labelled `needs_review` | Rejecting keeps the post, sets `match_status = 'rejected'` and excludes it from refresh. Approving sets `match_status = 'matched'` and the caption. Write errors are checked |

New tests: `tests/paginate.test.ts`, and a day-window test for runs that cross midnight.

### Third pass (2026-11-21): the remaining medium and low items

All checks still pass after this pass: type-check, lint, `npm test` (81 tests, now run with `node --test` across every file) and the production build. The schema changes are in the same migration, `20261126_security_and_tracking_fixes.sql`.

**Metric integrity**
- `metric_snapshots.delta_*` are nullable. A delta is `null` when either side was not measured (`lib/metrics/integrity.ts`). The migration also clears historic fake zeros.
- Snapshot upserts leave out unmeasured metrics, so a re-run on the same day never overwrites a measured value with `null`.
- Values that were never measured now show "n/a" instead of 0:
  - leaderboard followers
  - caption totals
  - volunteer-page totals
- Instagram view counts below zero are treated as unmeasured.
- A missing Instagram media type stays `null`; it is no longer guessed as "Image".

**IST**
- Post times are shown in IST (`formatIstDateTime`).
- Day labels are timezone-proof (`formatDayLabel`).
- `formatDisplayDate*` use `Asia/Kolkata`.
- The volunteer timeline groups posts by IST day.
- "7d" now means 7 calendar days.
- Snapshot-date column defaults are the IST date.

**Old webhook removed**
- Removed:
  - `app/api/webhooks/apify`
  - `app/api/apify/*`
  - `lib/apify/trigger.ts`
  - the webhook secret, `parseWebhook` and the middleware exemption
  - the Settings actions for webhooks
  - `NEXT_PUBLIC_APP_URL`, `APIFY_WEBHOOK_SECRET` and the Bright Data env vars
- The middleware now refuses requests (503) when the Supabase env is missing, instead of letting them through.

**Security**
- CSV export: cells that start with `= + - @` are prefixed with `'`, so they can't run as formulas.
- `customInput` is removed from the trigger, and the `handles` / `urls` lists have size limits.
- `getCampaignCaptions`, `getMatrixData` and `getReviewQueueItems` check the caller themselves.
- `/api/settings/test-connection` is admin-only.
- `/api/review-queue/count` checks the session itself and sends a `private` cache header.
- `/api/auth/me` tells anonymous callers nothing.
- Routes that members can call return generic errors and log the details on the server (`lib/api/errors.ts`).
- Security headers are set: `X-Frame-Options`, `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS.
- `createAdminClient` refuses to run in the browser.
- Encryption:
  - new secrets use scrypt to derive the key
  - a 16-byte auth tag is required
  - an empty `SETTINGS_ENCRYPTION_KEY` counts as unset, the same as in `env.ts`
  - secrets saved under the service-role key still decrypt after a dedicated key is added
- `clean-db` and `seed-demo` require `--yes` plus typing the project ref.

**Correctness**
- Accounts that simply didn't post today are no longer flagged "not visible".
- Posts only match an account on the same platform; the bare-handle fallback is gone.
- Posts from handles that aren't monitored accounts are counted in `collection_runs.posts_skipped_unknown`. Posts dropped by the day window are counted in `posts_outside_day_window`. `posts_found` is now the number fetched before the day window.
- Facebook handles come from the first segment of the post URL (not the `pfbid…` post ID). A display name is never used as a handle.
- With the caption filter off, no matching is done at all.
- The per-post routing rules live in one pure function, `lib/services/post-routing.ts`, which both ingestion and the tests use. `tests/matching_workflow_integration.test.ts` now tests the real rules ("keep everything, label it") instead of its own copy of the pipeline.
- Review approval works for Facebook and X, because it uses that platform's refresh actor. Instagram refresh uses the refresh actor configured in Settings.
- When a refresh gets no data back for a post (deleted or private), the post isn't re-sent until its next interval.
- X discovery skips pinned posts.
- Reading settings throws on a database error instead of silently using defaults.
- `matchStoredPosts` processes 8 posts at a time, and calls that overlap are merged into one run plus one follow-up run.

**Performance**
- Dashboard widgets share one snapshot load per request (React `cache()`), instead of about seven full reloads.
- The matrix and caption stats use the SQL views `matched_post_latest_metrics` and `post_latest_snapshot`, instead of downloading every snapshot.
- The matrix shows 100 rows per page.
- The Posts list fetches only each post's latest snapshot.
- The leaderboard's account lookup is a map lookup (it was quadratic), and its accounts query is paged.
- The account search filter is capped so the request URL can't get too long.
- New indexes: on `posts.matched_caption_id`, a status + date index, a platform + date index, and a trigram index on `caption`.
- Account snapshots are written in batches.
- `raw_json` is stored only on a post's first snapshot. Storing it every day would have grown by tens of GB over the campaign.

**Dashboard accuracy**
- "Top posts" and the Content tab rank by engagement across the period, not just the newest 60 posts.
- The Health page totals cover the whole range, computed on the server, not just the runs listed.
- The Volunteers page totals follow the platform filter (new view `volunteer_platform_totals`).
- The matrix "Volunteers" count is people, not accounts.
- The volunteer page picks the account deterministically, pages its posts, and its labels say it shows current totals, not growth.

**Other**
- `types/database.ts` matches the migrations again.
- A CI workflow runs type-check, lint, tests and build (`.github/workflows/ci.yml`).
- `docs/GUIDE.md` describes the admin-triggered flow.

### Deliberately not changed

- **Splitting the large client components** (Accounts 1528 lines, Analytics 1053, Settings 888). This is a pure refactor with no behaviour change. It is best done with UI tests in place, so it has its own task.
- **Computing the period gains entirely in SQL.** The snapshots are now loaded once per request, which removes the repeated-load problem. A full SQL function for gain over a period is a larger redesign of `lib/metrics/gain.ts`.
- **A full Content-Security-Policy with nonces.** Framing is blocked now. A script CSP needs nonces for Next's inline scripts and Recharts.
- **Re-labelling matched posts when a caption is archived.** This is intentional: a post that matched a caption at the time it was posted stays a campaign post.
- **Counting a null baseline as 0 in run gain.** This is intentional and matches `gain.ts`; the doc comment was corrected.
- **`collection_runs.error` also holds the targeted handles and URLs.** This is how the design works; the code now keeps them on failure so a retry can use them.
- **`rules/AGENTS.md`** is an older copy of `AGENTS.md` that still describes webhooks. Delete it or sync it with the root file.

---

> **Note (2026-11-21):** This audit predates the move to admin-triggered collection. Items that mention Apify webhooks, "Register on Apify", Schedules (L6) or webhook hardening (#7, #9, L7) no longer reflect the intended design in `AGENTS.md`: there is no webhook or schedule, and the app polls and ingests itself via `/api/scraper/status`. Dashboard follow-ups done since: platform filter, per-volunteer leaderboard, real daily top-volunteer chart, server-side post paging/search, and a reworked Health page.

_Date: 2026-11-20. Baseline before changes: type-check, lint and all tests passed. After: same, plus 19 new tests and a clean production build._

## Summary

The architecture is sound (adapter pattern, idempotent upserts, Zod at the edges, clean provider abstraction). The main problems were **settings that looked functional but weren't**, **secrets that could only be changed by redeploying**, **no cost visibility**, and **a few security and hygiene gaps**.

---

## ✅ Fixed in this pass

| # | Problem | Impact | What changed |
|---|---------|--------|--------------|
| 1 | **Platform toggles were cosmetic.** `isPlatformEnabled()` read a hardcoded `enabled: false`, so saving the Facebook/X switch in Settings changed nothing | Settings looked broken | Toggles are read from the database and enforced in the orchestrator and trigger route |
| 2 | **`APIFY_API_TOKEN` was mandatory in the env schema**, and the Supabase admin client validates that schema | A missing Apify token could break *every* server feature, not just scraping | Made optional; token can live (encrypted) in Settings |
| 3 | **Credentials only changeable by editing env vars + redeploy** | Slow, error-prone | New encrypted credential store + smart-paste setup + one-click webhook registration |
| 4 | **Weekly-refresh runs were never ingested** unless someone had the dashboard open. Only task runs had a webhook | Refresh data silently lost | "Register on Apify" creates webhooks for the task *and* the actors |
| 5 | **No Apify cost tracking** | Couldn't answer "what does this platform cost?" | Per-run cost capture, SQL view, budget, forecast, comparison with the Apify account |
| 6 | Failed-run webhook used `upsert` with no conflict key | Duplicate / inconsistent `collection_runs` rows | Update-or-insert by run ID |
| 7 | Webhook and dashboard poller could both ingest the same run | Wasted work, race risk | Webhook exits early if the run is already `success` |
| 8 | Ingestion hardcoded `platform: "instagram"` in run logs | Facebook/X runs mislabelled | Platform passed through |
| 9 | Webhook secret compared with `===` | Timing side-channel | Constant-time comparison |
| 10 | Settings page claimed "Configured on Server" regardless of reality; "Default Mode" label ignored the saved mode | Misleading | Live status badges; labels follow real settings |
| 11 | README was a UTF-16 two-liner | No onboarding | Real README + `docs/GUIDE.md` |

---

## ⚠️ Still open (recommended next, in priority order)

### High

| # | Finding | Where | Recommendation |
|---|---------|-------|----------------|
| H1 | **Next.js 14.2.18 is behind security patches.** Versions before 14.2.25 have a known middleware-bypass (CVE-2025-29927), and this app leans on middleware for login protection | `package.json` | `npm i next@14` (latest 14.2.x) + `eslint-config-next` to match, retest. Also run `npm audit` |
| H2 | **First-admin bootstrap is open.** `/api/admin/users` skips middleware auth, and when the `profiles` table is empty *anyone* can create an admin | `app/api/admin/users/route.ts`, `middleware.ts` | Require a one-time `BOOTSTRAP_TOKEN` env var, or create the first admin via SQL and remove bootstrap mode |
| H3 | **Run the new migration before using the new cards.** Until `20261121_…sql` is applied, saving credentials/usage fails (with a clear message) | Supabase | Apply it; then paste token in Settings |

### Medium

| # | Finding | Recommendation |
|---|---------|----------------|
| M1 | `netlify.toml` still present, but `AGENTS.md` says production is **Vercel only** | Delete it |
| M2 | No unique index on `collection_runs(actor_run_id)`; duplicates are only prevented in code | Dedupe, then add a partial unique index |
| M3 | `lib/apify/trigger.ts` (~530 lines) duplicates the orchestrator and is only imported by one test (for two constants) | Move the constants, delete the file |
| M4 | Three `any` casts break the "zero `any`" rule (`app/api/export/snapshots/route.ts:86`, `lib/supabase/reviews.ts:95-96`) | Type the joined rows |
| M5 | `ACTIVE_SCRAPER_PROVIDER=brightdata` is accepted by the env schema but always throws | Remove from the enum until implemented |
| M6 | Credentials fall back to the service-role key for encryption if `SETTINGS_ENCRYPTION_KEY` is unset | Set the dedicated key |
| M7 | `system_settings` is readable by every logged-in user (fine for current non-secret contents) | Never store secrets there (secrets live in `integration_secrets`) |

### Low / quality

| # | Finding | Recommendation |
|---|---------|----------------|
| L1 | 8 `alert()` / `confirm()` calls in the UI | Replace with in-page confirmation dialogs |
| L2 | `/api/runs` returns a fixed 30 rows, filtered client-side on the Health page | Server-side date filter + pagination |
| L3 | `npm test` is one very long `&&` chain; a failure hides later files | Use `node --test tests/*.test.ts` |
| L4 | No route-level tests (auth, validation); no CI | Add a GitHub Action running tsc, lint, test, build |
| L5 | `docs/ARCHITECTURE.md` and `ARCHITECTURE_V2.md` overlap and are partly stale | Merge into one, link from README |
| L6 | The Apify Schedule is created by hand | Optional: create/verify it via the Apify API from Settings (keeps Apify as the only scheduler) |
| L7 | Webhook failure path stores the whole payload in `collection_runs.error` | Store only IDs and status |

---

## About the "do it with AI" request

Credential setup is automated, but with deterministic parsing and live validation rather than an LLM. Sending a pasted API token to a language model would put the secret in a third party's logs, and it isn't needed: tokens and URLs have fixed formats. An AI step is still a good fit for **explaining Apify errors** and **recommending cost savings** from the usage data, both of which can work on non-secret text. Say the word and it can be added behind an `ANTHROPIC_API_KEY`.

## Verification performed

- `npx tsc --noEmit`: clean
- `npx next lint`: clean
- `npm test`: all suites pass, including 19 new tests (encryption round-trip/tamper, paste detection, cost totals, projection, budget states, forecast)
- `npx next build`: succeeds, new routes `/api/admin/integrations` and `/api/admin/usage` present

**Not verified:** live calls to Apify and Supabase (no credentials were used). The first real run after applying the migration is the true end-to-end test; check the Credit Usage card after one scrape completes.
