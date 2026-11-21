# Socio: Setup & Operations Guide

Socio tracks volunteers' Instagram (and optionally Facebook / X) posts, matches them to campaign captions, and shows engagement on a private dashboard. Apify does the scraping; Supabase stores the data; Vercel hosts the app.

> **Who this is for:** the admin who sets Socio up and keeps it running. No coding needed for anything in sections 1–5.

---

## 1. Quick setup (about 10 minutes)

| # | Step | Where |
|---|------|-------|
| 1 | Run the SQL migrations **in order** (the newest is `20261121_integrations_and_usage_tracking.sql`) | Supabase → SQL Editor |
| 2 | Add the environment variables in the table below | Vercel → Project → Settings → Environment Variables |
| 3 | Deploy, sign in as admin | Your Vercel URL |
| 4 | **Settings → Apify Connection** → paste your token → *Detect & Connect* | Socio |
| 5 | Same card → *Generate secret* → *Register on Apify* | Socio |
| 6 | Create the daily **Apify Schedule** (08:00 IST = 02:30 UTC) for your Instagram task | Apify console |
| 7 | **Settings → Apify Credit Usage** → set a monthly budget | Socio |

### Environment variables (only these are required)

| Variable | Required | What it is |
|----------|:--------:|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase public (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service key. **Server only, never share** |
| `NEXT_PUBLIC_APP_URL` | yes | Your public URL, e.g. `https://socio.vercel.app` (used to build the webhook URL) |
| `SETTINGS_ENCRYPTION_KEY` | recommended | Any random 32+ character string. Encrypts credentials saved in Settings |
| `APIFY_API_TOKEN` | **no** | Optional now. Prefer pasting it in Settings |
| `APIFY_WEBHOOK_SECRET`, `APIFY_TASK_ID`, actor IDs | **no** | Optional now. Managed in Settings |

> **Set `SETTINGS_ENCRYPTION_KEY` once and never change it.** If it changes, saved credentials can't be decrypted and you'll have to paste them again. If you don't set it, Socio uses your Supabase service key as the encryption key instead (works, but rotating that key then locks your saved credentials).

---

## 2. Connecting Apify from Settings

**Settings → Apify Connection & Credentials** (admins only).

1. Paste *anything* into the box: a bare token, a `.env` snippet, an Apify task link.
2. Click **Detect & Connect**. Socio will:
   - find the token, task and actor IDs in your text,
   - test the token against Apify **before saving anything**,
   - save it encrypted (AES-256-GCM),
   - look through your Apify tasks and pick your Instagram task automatically (if several match, it asks you to choose).
3. Click **Register on Apify**. Socio creates the webhook on your Apify account for you (or refreshes it if it exists).

**About "AI":** the detection is deliberate, rule-based code, *not* a language model. That's on purpose: your token never leaves your server except to Apify itself. An optional AI helper that explains Apify errors in plain English could be added later, working only on error text with secrets removed.

**Where does each value come from?** Every value shows a badge: *Saved in Settings (encrypted)*, *From .env / Vercel variable*, or *Not set*. Settings wins over environment variables.

---

## 3. How the daily flow works

```
Apify Schedule (08:00 IST)
        │  runs your Instagram task
        ▼
Apify finishes ──► webhook POST /api/webhooks/apify  (secret checked)
        ▼
Socio downloads the dataset ──► matches posts to captions ──► saves posts + daily snapshots
        ▼
Socio asks Apify what the run cost ──► saves it  (Credit Usage card)
        ▼
Dashboard shows fresh numbers
```

- **No cron jobs in Socio.** Apify Schedules is the only scheduler.
- **Safe to repeat.** Re-running the same day, or Apify re-sending the webhook, never creates duplicates: posts are upserted and each post has at most one snapshot per day.
- **Weekly refresh** (re-checking likes/comments on older posts) is started from Settings → *Refresh Eligible Posts Now*. Its results arrive through the same webhook, which is why step 5 of setup matters.

---

## 4. Apify credit usage

**Settings → Apify Credit Usage** (admins only).

### How the number is calculated
1. Each time Socio runs (or ingests) an Apify run, it records the run ID.
2. When the run finishes, Socio asks Apify for that run's real cost (`usageTotalUsd`) and stores it.
3. The database adds these up per day, platform and job type.
4. Socio compares the total with your Apify account's own usage, so you can see what share of your bill the platform caused.

### Reading the card
| Item | Meaning |
|------|---------|
| Spent this billing cycle | Sum of costs for runs Socio knows about since your Apify cycle started |
| Projected | Average daily spend × days in cycle (needs 3+ days of data) |
| Monthly budget used | Spend ÷ the budget you set. Turns amber at your warning %, red over 100% |
| Cost per stored post | Money spent ÷ posts actually kept after matching |
| Your Apify account | Apify's total for the cycle. *Not logged by Socio* = manual runs, other projects, storage |
| Forecast | Estimated monthly cost at your **current** settings (accounts × post limit, plus weekly refresh of tracked posts) |
| **Sync costs from Apify** | Fetches cost for finished runs that don't have one yet |

### Good to know
- A run's cost appears **after it finishes**. Runs still waiting show as "pending".
- Until your first costed run, the forecast uses an **assumed** price of $0.0023 per item. It switches to your measured price automatically; the card says which one it is using.
- Treat Apify's own billing page as the source of truth. The card should match it for runs Socio started; a gap means runs happened outside Socio.
- To lower cost: use the **30-day window** strategy, lower *Discovery Post Limit*, or raise *Refresh Interval*. The forecast updates as you change them.

---

## 5. Settings reference

| Setting | What it does | Default |
|---------|--------------|---------|
| Refresh strategy: 30-day window | Re-checks each post weekly for its first 30 days, then freezes it | **On** |
| Refresh strategy: continuous | Re-checks every tracked post forever (costs more) | Off |
| Refresh interval | Days between re-checks of a post | 7 |
| Discovery post limit | Recent posts fetched per account per day | 10 |
| Facebook / X toggles | Allow those platforms to run. **Enforced on the server** | Off |
| Instagram | Always on | On |
| Monthly budget | Triggers the warning/over-budget banner | none |

---

## 6. Troubleshooting

| You see | Likely cause | Fix |
|---------|--------------|-----|
| "Apify API token is not configured" | No token saved | Settings → paste token |
| "Apify rejected this token - nothing was saved" | Token revoked/typo | Create a new one at console.apify.com/account/integrations |
| "Could not read usage… run …20261121…sql" | Migration not applied | Run it in Supabase SQL Editor |
| Cost shows "pending" for hours | Run still going, or Apify hasn't published cost | Click **Sync costs**; try again later |
| "Could not decrypt stored credential" | `SETTINGS_ENCRYPTION_KEY` / service key changed | Paste the token again in Settings |
| "Apify cannot reach localhost" | Registering webhook from a local machine | Do it from the deployed site, or type your Vercel URL in the box |
| Data doesn't update after a run | Webhook missing or secret mismatch | Click **Register on Apify** again (it re-syncs the secret) |
| "Platform 'facebook' is disabled" | Toggle is off | Settings → Multi-Platform → enable it |
| Dashboard Settings page shows no admin cards | You're a Standard Member | Ask an admin to change your role |

---

## 7. Security notes

- Tokens saved in Settings are encrypted in the `integration_secrets` table. That table has **no** access for logged-in users, only the server's service key.
- Secrets are never sent to the browser. The UI only ever sees a masked value (`apify_api_…x9Zq`). The one exception: a freshly generated webhook secret is displayed once, for manual setups.
- The webhook rejects requests without the correct secret and compares it in constant time.
- See [AUDIT.md](./AUDIT.md) for open security items (notably the Next.js version and the first-admin bootstrap).

---

## 8. For developers

| Area | Files |
|------|-------|
| Encryption | `lib/services/crypto.ts` |
| Saved credentials & task/actor config | `lib/services/integrations.ts` |
| Paste-detection | `lib/services/smart-setup.ts` |
| Cost tracking, budget, forecast | `lib/services/apify-usage.ts`, SQL view `apify_usage_daily` |
| Admin APIs | `app/api/admin/integrations`, `app/api/admin/usage`, `app/api/admin/settings` |
| UI | `components/settings/IntegrationsCard.tsx`, `ApifyUsageCard.tsx` |
| Scraping pipeline | `lib/services/scraper-orchestrator.ts`, `lib/scrapers/*`, `app/api/webhooks/apify` |

```bash
npm test          # all unit tests (pure logic, no network)
npx tsc --noEmit  # type-check
npm run lint
npm run build
```

Rules the code follows are in `AGENTS.md` (strict TypeScript, Zod at boundaries, idempotent upserts, no cron outside Apify).
