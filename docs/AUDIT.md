# Socio Codebase Audit

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
