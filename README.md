# Socivo Outreach Engine

Internal cold-email platform replacing SmartLead. Import leads → per-lead AI research →
personalised drafts inside template guardrails → approve the first 10, then auto → send from your
own Gmail/Outlook inboxes via **HTTPS APIs only** (no SMTP/IMAP) → detect replies/bounces/
unsubscribes and stop sequences → master inbox, analytics, notifications. Multi-workspace
(one per client; pilot = Socivo). **Running cost: £0/month** — Vercel free tier + Supabase free tier.

## Architecture

- **Next.js 14 (App Router, TypeScript)** on Vercel — dashboard, OAuth callbacks, tracking pixel
  (`/o/{token}`), click redirect (`/r/{token}`), unsubscribe page (`/u/{token}`), health endpoint,
  REST API (`/api/v1/*`).
- **Supabase** — Postgres with **RLS per workspace** on every table, Auth (email/password +
  invites), and two Deno **edge functions**:
  - `tick` — invoked every minute by pg_cron via pg_net: day rollover → token refresh → send due
    (jitter, ramp, domain caps, suppression re-checks) → reply polling + classification →
    research queue → circuit breakers → notifications → daily digests.
  - `research` — chunked research/draft processor (site scrape → sourced brief → writer → QA gates),
    one stage per lead per invocation by design.
- **Provider chains** (`config/providers.ts`) — every external capability (AI write/brief/classify,
  verification, scrape, search, LinkedIn) is an ordered chain with automatic failover on
  quota/error. No provider is hardcoded at any call site.

## Deployment guide

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com). Note the project URL, anon key and
   service-role key (Settings → API).
2. Dashboard → Database → Extensions: enable **pg_cron** and **pg_net** (pg_trgm/pgcrypto are
   enabled by migration).
3. Apply migrations in order — either `supabase db push` with the CLI, or paste each file from
   `supabase/migrations/` (0001 → 0007) into the SQL editor.
4. Run the RLS isolation test: paste `supabase/tests/rls_isolation_test.sql` into the SQL editor —
   it must print `PASS: RLS workspace isolation holds` (it rolls itself back).
5. Deploy the edge functions:
   ```bash
   supabase functions deploy tick --no-verify-jwt
   supabase functions deploy research --no-verify-jwt
   ```
6. Set edge-function secrets (Functions → Settings, or `supabase secrets set`): `ENCRYPTION_KEY`,
   `TRACKING_DOMAIN`, `GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET/TENANT`, plus every provider
   API key you have (see `.env.example`). `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are injected
   automatically.
7. Schedule the tick (SQL editor, replacing placeholders — see `supabase/migrations/0006_cron.sql`):
   ```sql
   select cron.schedule('tick','* * * * *',
     $$ select net.http_post(
          url := 'https://<PROJECT_REF>.supabase.co/functions/v1/tick',
          headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
          body := '{}'::jsonb) $$);
   ```

### 2. OAuth apps (you supply)

- **Google Cloud Console** → create an OAuth client (Web application). Enable the Gmail API.
  Scopes: `gmail.send`, `gmail.readonly`. Redirect URI: `{APP_URL}/api/oauth/google/callback`.
- **Azure App Registration** (free) → add a Web redirect URI
  `{APP_URL}/api/oauth/microsoft/callback`, create a client secret. Delegated Graph permissions:
  `Mail.Send`, `Mail.ReadWrite`, `User.Read`, `offline_access`.

### 3. Vercel

1. Import this repo into Vercel (free tier).
2. Set every variable from `.env.example` in Project Settings → Environment Variables.
   Generate `ENCRYPTION_KEY` with `openssl rand -hex 32`.
3. Add your tracking domain (e.g. `go.socivo.co.uk`) as a domain on the project (CNAME to Vercel)
   and set `TRACKING_DOMAIN` to it.
4. Deploy. `GET /api/health` reports missing config and which optional capabilities are degraded.

### 4. Keep-alive

Create a free [cron-job.org](https://cron-job.org) job hitting `{APP_URL}/api/health` daily —
backup against Supabase's ~7-day inactivity pause (the pg_cron tick already generates activity).

### 5. First run (pilot acceptance path)

1. Sign up → create the **Socivo** workspace.
2. **Knowledge** — fill the profile (offer, ICP, proof points, tone, banned phrases,
   **footer identity** — required in every email — and your seed test inboxes).
3. **Mailboxes** — connect one Gmail + one Outlook; run the DNS check (SPF/DKIM/DMARC must pass);
   send a test email from each.
4. **Leads** — import a CSV (mapping wizard dedupes per workspace), run verification (layer-0 free
   checks, then the provider chain with failover).
5. **Campaigns** — build a sequence (steps, delays, A/B variants, spintax, `{{vars}}`,
   `{{ai_slots}}`), attach mailboxes, add the audience, set the schedule, check the **Review** tab
   (10 real leads rendered), run a **seed test**, then **Launch**. The launch gate blocks on DNS,
   subject, window, audience and mailbox health.
6. Approve the first 10 drafts in **Approvals** — after that, passing drafts auto-approve.
7. Replies land in the **Inbox** categorised; positive replies notify instantly (email/Telegram/n8n
   per Settings → Notifications).

## Contacts (CRM-style 1:1 flow)

Alongside bulk campaigns, the **Contacts** page is a simpler front door to the same engine for
one-at-a-time outreach: add a person (email + name), pick a template, set a cadence
("follow up every N days, up to M times") and the engine does the rest — sending, in-thread
follow-ups, stop-on-reply. Behind the scenes each (template, cadence) combo becomes a reusable
always-on campaign, so every deliverability guard applies unchanged. AI-slot templates always wait
for your approval before sending; static templates schedule immediately. Every contact carries a
derived **temperature**: 🟢 warm (interested/info request) · 🔵 cold (no reply yet, sequence
running) · 🟡 neutral (not now/OOO — rescheduled, not dead) · 🔴 rejected (not interested/bounced/
unsubscribed). Sequences stop automatically on warm and rejected, continue on cold, and push +3
business days on OOO. Adding a contact also turns on instant notifications for *any* reply (not
just positive) — dial it back in Settings → Notifications if too chatty.

## Deliverability Guard (enforced, not suggested)

Launch gate (blocking DNS checks) · warm-up ramp wk1 8/day → wk4 cap (hard max 50/day) · 2–9 min
jitter · campaign send windows in the lead's timezone · hard 06:00–21:00 lead-local ceiling ·
≤5/day per recipient domain per campaign · circuit breakers (>3% bounce over trailing 50 sends
pauses the campaign; 3 consecutive failures or auth error pauses the mailbox) · unsubscribe link +
footer identity in every email · suppression (email + domain, workspace + global) re-checked at
send time · free consumer domains blocked unless explicitly allowed · seed testing that never
counts in analytics · guided Google Postmaster setup (Settings → Deliverability).

## Development

```bash
npm install
cp .env.example .env   # fill in
npm run dev            # http://localhost:3000
npm run typecheck
npm test               # vitest unit tests (ramp, lint, render, schedule, csv, crypto)
```

Repo layout follows the build brief: `/app` (routes), `/components`, `/lib` (providers/, gmail,
graph, crypto, lint, …), `/supabase/migrations`, `/supabase/functions/{tick,research,_shared}`,
`/config` (provider chains, spam words, ramp — edit these, never inline), `brand.config.ts`
(design tokens; white-max UI rules).

### Notes & honest caveats

- Free tiers change; if Supabase/Vercel tighten limits the fallback is a ~£4/mo VPS running the
  same tick. Only the invocation point moves.
- Provider free-tier quotas in `config/providers.ts` are conservative in-house ceilings —
  **confirm each provider's current free tier when you sign up for keys.**
- Opens/clicks tracking is off by default (plain-text mode is the deliverability-friendly default)
  and labelled "unreliable by nature" where shown.
- `supabase/functions/_shared/` mirrors a few pure modules from `/lib` and `/config` because edge
  functions can't import from the Next tree — keep them in sync when editing either side.
