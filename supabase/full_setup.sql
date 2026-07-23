-- Socivo — full database setup (migrations 0001–0012 combined).
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New query → paste ALL of this → Run.
-- No extensions to pre-enable — this preview setup only needs pg_trgm + pgcrypto,
-- which the script creates itself. (pg_cron/pg_net are only for automated sending later.)
-- Safe to run ONCE on a brand-new project.


-- ============================================================
-- 0001_extensions_and_types.sql
-- ============================================================
-- Extensions
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
-- pg_cron and pg_net are enabled from the Supabase dashboard (Database → Extensions)
-- because they require superuser grants on the `cron`/`net` schemas.

-- Enums
create type mailbox_provider as enum ('google','microsoft');

create type verify_status as enum ('unverified','valid','invalid','risky','unknown');

create type cl_state as enum ('queued','researching','drafted','awaiting_approval','approved',
  'scheduled','in_sequence','replied','positive','bounced','unsubscribed','finished','paused','failed');

create type reply_category as enum ('interested','info_request','not_now','not_interested',
  'ooo','wrong_person','bounce','unsubscribe','other');

-- ============================================================
-- 0002_identity_tenancy.sql
-- ============================================================
-- identity & tenancy
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text not null,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('admin','member','viewer')),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members(user_id);

-- invites: admin invites an email; on signup the membership is claimed
create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member','viewer')),
  invited_by uuid references users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index workspace_invites_email_idx on workspace_invites(email);

-- mirror auth.users into public.users on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;

  -- claim any pending invites for this email
  insert into public.workspace_members (workspace_id, user_id, role)
  select wi.workspace_id, new.id, wi.role
  from public.workspace_invites wi
  where lower(wi.email) = lower(new.email) and wi.accepted_at is null
  on conflict do nothing;

  update public.workspace_invites
  set accepted_at = now()
  where lower(email) = lower(new.email) and accepted_at is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- membership helper used by every RLS policy.
-- SECURITY DEFINER so policies on workspace_members itself don't recurse.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================
-- 0003_core_tables.sql
-- ============================================================
-- mailboxes
create table mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider mailbox_provider not null,
  email text not null,
  display_name text,
  refresh_token_enc text,
  access_token_enc text,
  access_token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','auth_error')),
  daily_cap int not null default 40 check (daily_cap between 1 and 50),
  ramp_started_at date not null default current_date,
  sent_today int not null default 0,
  sent_date date not null default current_date,
  health_score int not null default 100,
  consecutive_failures int not null default 0,
  poll_cursor text,            -- gmail historyId / graph deltaLink
  last_polled_at timestamptz,
  signature_html text,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index mailboxes_workspace_idx on mailboxes(workspace_id);
create index mailboxes_status_idx on mailboxes(status);

-- leads
create table lead_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index lead_lists_workspace_idx on lead_lists(workspace_id);

create table leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  list_id uuid references lead_lists(id) on delete set null,
  email text not null,
  first_name text,
  last_name text,
  company text,
  domain text,
  title text,
  linkedin_url text,
  timezone text,
  custom jsonb not null default '{}',
  verify_status verify_status not null default 'unverified',
  verify_provider text,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index leads_workspace_idx on leads(workspace_id);
create index leads_list_idx on leads(list_id);
create index leads_email_idx on leads(email);
create index leads_domain_idx on leads(domain);

create table domain_research_cache (
  domain text primary key,
  content jsonb,
  fetched_at timestamptz not null default now()   -- 30-day TTL enforced in code
);

create table lead_research (
  lead_id uuid primary key references leads(id) on delete cascade,
  brief jsonb,
  sources jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  updated_at timestamptz not null default now()
);

-- templates & campaigns
create table templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,   -- null = global library
  name text not null,
  subject text not null,
  body text not null,
  ai_slots jsonb not null default '{}',
  -- ai_slots: { "ai_icebreaker": {"instruction":"...","max_words":30}, ... }
  created_at timestamptz not null default now()
);
create index templates_workspace_idx on templates(workspace_id);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','running','paused','done')),
  settings jsonb not null default '{}',
  -- settings: { plain_text:true, track_opens:false, track_clicks:false, approve_first_n:10,
  --             send_window:{start:"08:30",end:"17:30",days:[1,2,3,4,5]}, timezone_mode:"lead|fixed",
  --             fixed_tz:"Europe/London", linkedin_enrichment:false, daily_domain_cap:5,
  --             allow_free_domains:false, us_targeting:false }
  created_at timestamptz not null default now()
);
create index campaigns_workspace_idx on campaigns(workspace_id);
create index campaigns_status_idx on campaigns(status);

create table campaign_mailboxes (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  primary key (campaign_id, mailbox_id)
);

create table sequence_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_no int not null,
  variant char(1) not null default 'A',
  delay_days int not null default 0,
  subject text,        -- step 1 subject required (enforced at launch gate); later blank = same thread
  body text not null,
  unique (campaign_id, step_no, variant)
);
create index sequence_steps_campaign_idx on sequence_steps(campaign_id);

create table campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  mailbox_id uuid references mailboxes(id) on delete set null,
  state cl_state not null default 'queued',
  current_step int not null default 0,
  variant char(1) not null default 'A',
  next_send_at timestamptz,
  approved_count int not null default 0,
  stop_reason text,
  created_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index campaign_leads_campaign_idx on campaign_leads(campaign_id);
create index campaign_leads_lead_idx on campaign_leads(lead_id);
create index campaign_leads_mailbox_idx on campaign_leads(mailbox_id);
create index campaign_leads_state_idx on campaign_leads(state);
create index campaign_leads_next_send_idx on campaign_leads(next_send_at);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  campaign_lead_id uuid not null references campaign_leads(id) on delete cascade,
  step_no int not null,
  subject text,
  body text not null,
  qa jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  edited_body text,
  edited_subject text,
  created_at timestamptz not null default now(),
  unique (campaign_lead_id, step_no)
);
create index drafts_status_idx on drafts(status);
create index drafts_campaign_lead_idx on drafts(campaign_lead_id);

-- messages & events
create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  mailbox_id uuid references mailboxes(id) on delete set null,
  campaign_lead_id uuid references campaign_leads(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')),
  step_no int,
  provider_message_id text,
  provider_thread_id text,
  internet_message_id text,
  in_reply_to text,
  from_email text,
  to_email text,
  subject text,
  snippet text,
  body text,
  category reply_category,
  is_seed boolean not null default false,   -- seed tests never count in analytics
  is_internal boolean not null default false, -- notification emails, excluded from analytics
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index messages_workspace_idx on messages(workspace_id);
create index messages_mailbox_idx on messages(mailbox_id);
create index messages_campaign_lead_idx on messages(campaign_lead_id);
create index messages_internet_message_id_idx on messages(internet_message_id);
create index messages_direction_idx on messages(direction);
create index messages_occurred_idx on messages(occurred_at);
create index messages_body_trgm_idx on messages using gin (body gin_trgm_ops);

create table events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  campaign_lead_id uuid references campaign_leads(id) on delete set null,
  type text not null check (type in ('open','click','bounce','reply','unsubscribe','send_fail')),
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_workspace_idx on events(workspace_id);
create index events_message_idx on events(message_id);
create index events_campaign_lead_idx on events(campaign_lead_id);
create index events_type_idx on events(type);
create index events_created_idx on events(created_at);

-- ============================================================
-- 0004_hygiene_config.sql
-- ============================================================
-- hygiene & config
create table suppression (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,   -- null = global
  value text not null,
  kind text not null check (kind in ('email','domain')),
  reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, value, kind)
);
create index suppression_value_idx on suppression(value);
create index suppression_workspace_idx on suppression(workspace_id);

create table provider_keys (
  id uuid primary key default gen_random_uuid(),
  capability text not null,
  provider text not null,
  key_enc text,
  priority int not null default 100,
  active boolean not null default true,
  unique (capability, provider)
);

create table provider_usage (
  provider text not null,
  capability text not null,
  day date not null default current_date,
  used int not null default 0,
  failed int not null default 0,
  primary key (provider, capability, day)
);

create table knowledge (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  profile jsonb not null default '{}',
  -- profile: { what_we_sell, offer, icp, pains[], proof_points[], tone_rules,
  --            banned_phrases[], sender_name, footer_identity, postal_address, seed_emails[] }
  updated_at timestamptz not null default now()
);

create table notification_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  email_to text,
  email_from_mailbox uuid references mailboxes(id) on delete set null,
  telegram boolean not null default false,
  n8n boolean not null default false,
  instant_events text[] not null default '{positive_reply,breaker_tripped,mailbox_disconnected}',
  digest_hour int not null default 8 check (digest_hour between 0 and 23),
  last_digest_date date
);

create table webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url text not null,
  events text[] not null default '{reply,positive_reply,bounce,unsubscribe,sequence_finished}',
  secret text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index webhooks_workspace_idx on webhooks(workspace_id);

-- outbound notification queue, flushed by the tick
create table notification_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}',
  channels text[] not null default '{}',      -- email|telegram|n8n|webhook
  status text not null default 'pending' check (status in ('pending','sent','failed','digest')),
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index notification_queue_status_idx on notification_queue(status);
create index notification_queue_workspace_idx on notification_queue(workspace_id);

-- one-shot alert dedupe (e.g. "chain exhausted" once/day)
create table alert_log (
  key text not null,
  day date not null default current_date,
  primary key (key, day)
);

-- ============================================================
-- 0005_rls.sql
-- ============================================================
-- Row-level security: workspace isolation on every table carrying workspace_id.
-- The web app always uses the anon key + user JWT (RLS enforced).
-- Edge functions use the service role, which bypasses RLS by design.

-- users: a user can see/update only their own row
alter table users enable row level security;
create policy users_self_select on users for select using (id = auth.uid());
create policy users_self_update on users for update using (id = auth.uid());

-- workspaces: visible to members; any authed user can create; admins update
alter table workspaces enable row level security;
create policy workspaces_member_select on workspaces for select
  using (is_workspace_member(id));
create policy workspaces_insert on workspaces for insert
  with check (auth.uid() is not null);
create policy workspaces_admin_update on workspaces for update
  using (is_workspace_admin(id));
create policy workspaces_admin_delete on workspaces for delete
  using (is_workspace_admin(id));

-- workspace_members
alter table workspace_members enable row level security;
create policy members_select on workspace_members for select
  using (is_workspace_member(workspace_id));
-- bootstrap: creator inserts their own admin row; thereafter admins manage
create policy members_insert on workspace_members for insert
  with check (
    (user_id = auth.uid() and not exists (select 1 from workspace_members m where m.workspace_id = workspace_members.workspace_id))
    or is_workspace_admin(workspace_id)
  );
create policy members_update on workspace_members for update
  using (is_workspace_admin(workspace_id));
create policy members_delete on workspace_members for delete
  using (is_workspace_admin(workspace_id) or user_id = auth.uid());

-- workspace_invites
alter table workspace_invites enable row level security;
create policy invites_select on workspace_invites for select
  using (is_workspace_member(workspace_id));
create policy invites_admin_write on workspace_invites for insert
  with check (is_workspace_admin(workspace_id));
create policy invites_admin_delete on workspace_invites for delete
  using (is_workspace_admin(workspace_id));

alter table mailboxes enable row level security;
create policy mailboxes_member_all on mailboxes for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

alter table lead_lists enable row level security;
create policy lead_lists_member_all on lead_lists for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

alter table leads enable row level security;
create policy leads_member_all on leads for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

alter table lead_research enable row level security;
create policy lead_research_member_all on lead_research for all
  using (exists (select 1 from leads l where l.id = lead_research.lead_id and is_workspace_member(l.workspace_id)))
  with check (exists (select 1 from leads l where l.id = lead_research.lead_id and is_workspace_member(l.workspace_id)));

-- domain_research_cache holds only public web content; readable by any authed
-- user, written by the service role (edge functions) only.
alter table domain_research_cache enable row level security;
create policy drc_authed_select on domain_research_cache for select
  using (auth.uid() is not null);

alter table templates enable row level security;
create policy templates_select on templates for select
  using (workspace_id is null and auth.uid() is not null or is_workspace_member(workspace_id));
create policy templates_write on templates for insert
  with check (workspace_id is not null and is_workspace_member(workspace_id));
create policy templates_update on templates for update
  using (workspace_id is not null and is_workspace_member(workspace_id));
create policy templates_delete on templates for delete
  using (workspace_id is not null and is_workspace_member(workspace_id));

alter table campaigns enable row level security;
create policy campaigns_member_all on campaigns for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

alter table campaign_mailboxes enable row level security;
create policy campaign_mailboxes_member_all on campaign_mailboxes for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)));

alter table sequence_steps enable row level security;
create policy sequence_steps_member_all on sequence_steps for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)));

alter table campaign_leads enable row level security;
create policy campaign_leads_member_all on campaign_leads for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)));

alter table drafts enable row level security;
create policy drafts_member_all on drafts for all
  using (exists (
    select 1 from campaign_leads cl join campaigns c on c.id = cl.campaign_id
    where cl.id = drafts.campaign_lead_id and is_workspace_member(c.workspace_id)))
  with check (exists (
    select 1 from campaign_leads cl join campaigns c on c.id = cl.campaign_id
    where cl.id = drafts.campaign_lead_id and is_workspace_member(c.workspace_id)));

alter table messages enable row level security;
create policy messages_member_select on messages for select
  using (is_workspace_member(workspace_id));
create policy messages_member_insert on messages for insert
  with check (is_workspace_member(workspace_id));

alter table events enable row level security;
create policy events_member_select on events for select
  using (is_workspace_member(workspace_id));

alter table suppression enable row level security;
create policy suppression_select on suppression for select
  using (workspace_id is null and auth.uid() is not null or is_workspace_member(workspace_id));
create policy suppression_insert on suppression for insert
  with check (workspace_id is not null and is_workspace_member(workspace_id));
create policy suppression_delete on suppression for delete
  using (workspace_id is not null and is_workspace_member(workspace_id));

alter table knowledge enable row level security;
create policy knowledge_member_all on knowledge for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

alter table notification_settings enable row level security;
create policy notification_settings_member_all on notification_settings for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

alter table webhooks enable row level security;
create policy webhooks_member_all on webhooks for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

alter table notification_queue enable row level security;
create policy notification_queue_member_select on notification_queue for select
  using (is_workspace_member(workspace_id));

-- service-role-only tables: RLS enabled, NO policies → anon/authed can't touch them.
alter table provider_keys enable row level security;
alter table provider_usage enable row level security;
alter table alert_log enable row level security;

-- ============================================================
-- 0006_cron.sql
-- ============================================================
-- pg_cron schedule for the tick engine.
-- RUN THIS MANUALLY in the SQL editor AFTER deploying the edge functions,
-- replacing <PROJECT_REF> and <SERVICE_ROLE_KEY>. It is included as a
-- migration for the record; the placeholders make it a no-op until edited.
--
--   select cron.schedule(
--     'tick', '* * * * *',
--     $$ select net.http_post(
--          url := 'https://<PROJECT_REF>.supabase.co/functions/v1/tick',
--          headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
--          body := '{}'::jsonb) $$);
--
-- Daily self-ping keeps the Vercel app + Supabase project warm (07:00 UTC):
--
--   select cron.schedule(
--     'health-ping', '0 7 * * *',
--     $$ select net.http_get(url := 'https://<APP_URL>/api/health') $$);
--
-- Backup keep-alive: create a free cron-job.org job hitting
-- https://<APP_URL>/api/health once a day. This guards against Supabase's
-- ~7-day inactivity pause even if pg_cron is ever disabled.
select 1;

-- ============================================================
-- 0007_claim_function.sql
-- ============================================================
-- Atomic claim of due sends for the tick engine. FOR UPDATE SKIP LOCKED means
-- overlapping ticks never double-send; claimed rows get next_send_at pushed
-- 10 minutes so a crashed tick self-heals (the row simply comes due again).
create or replace function claim_due_sends(batch int default 20)
returns setof campaign_leads
language sql
security definer set search_path = public
as $$
  update campaign_leads
  set next_send_at = now() + interval '10 minutes'
  where id in (
    select cl.id
    from campaign_leads cl
    join campaigns c on c.id = cl.campaign_id
    where cl.state in ('scheduled','in_sequence')
      and cl.next_send_at <= now()
      and c.status = 'running'
    order by cl.next_send_at
    for update of cl skip locked
    limit batch
  )
  returning *;
$$;

-- service-role only
revoke execute on function claim_due_sends(int) from public, anon, authenticated;

-- atomic mailbox send-counter bump, resetting on day rollover
create or replace function bump_mailbox_sent(mb uuid)
returns void
language sql
security definer set search_path = public
as $$
  update mailboxes
  set sent_today = case when sent_date = current_date then sent_today + 1 else 1 end,
      sent_date = current_date,
      consecutive_failures = 0
  where id = mb;
$$;
revoke execute on function bump_mailbox_sent(uuid) from public, anon, authenticated;

-- trigram similarity check for writer QA: max similarity of `candidate`
-- against the workspace's last 200 sent outbound bodies
create or replace function max_body_similarity(ws uuid, candidate text)
returns real
language sql
security definer set search_path = public
stable
as $$
  select coalesce(max(similarity(m.body, candidate)), 0)
  from (
    select body from messages
    where workspace_id = ws and direction = 'outbound' and body is not null
      and is_seed = false and is_internal = false
    order by created_at desc
    limit 200
  ) m;
$$;
revoke execute on function max_body_similarity(uuid, text) from public, anon, authenticated;

-- ============================================================
-- 0008_provider_keys_vault.sql
-- ============================================================
-- In-app key vault. Recreate provider_keys to support MULTIPLE keys per
-- provider (stack free tiers to multiply quota) and per-key daily exhaustion.
-- A single API key (e.g. a Gemini key) serves every capability that provider
-- powers, so keys are stored per-provider, not per-capability.
-- Safe to run: no keys existed under the old shape.
drop table if exists provider_keys cascade;

create table provider_keys (
  id uuid primary key default gen_random_uuid(),
  provider text not null,        -- gemini | groq | openrouter | anthropic | reoon | ...
  label text,                    -- user's own note, e.g. "personal gmail key"
  key_enc text not null,         -- AES-256-GCM encrypted with ENCRYPTION_KEY
  priority int not null default 100,
  active boolean not null default true,
  exhausted_date date,           -- set to today when the key hits its free daily limit; cleared on rollover
  used_today int not null default 0,
  used_date date,
  created_at timestamptz not null default now()
);
create index provider_keys_provider_idx on provider_keys(provider);

-- service-role only: RLS on, no policies (the web app reaches it through a
-- membership-checked server route using the service role).
alter table provider_keys enable row level security;

-- ============================================================
-- 0009_lead_tags.sql
-- ============================================================
-- Audience tags: flexible labels on leads so people can be bucketed
-- (e.g. "saas", "london", "ceo", "apollo-import-jul") and campaigns can target
-- a tag directly. Lists remain the coarse bucket; tags are the flexible layer.
alter table leads add column if not exists tags text[] not null default '{}';
create index if not exists leads_tags_idx on leads using gin (tags);

-- ============================================================
-- 0010_workspace_members.sql
-- ============================================================
-- Access levels on the EXISTING workspace_members / workspace_invites model
-- (created in 0002; invites are auto-claimed on signup by handle_new_user()).
--
-- Roles: admin      — everything, incl. members & workspace settings
--        l3_full    — every feature, no member management
--        l2_limited — create/edit leads, campaigns, approvals; no settings, no deletes of others' work
--        l1_basic   — read-only (leads, inbox, analytics)

-- migrate legacy role names first, then retarget the check constraints
update workspace_members set role = 'l2_limited' where role = 'member';
update workspace_members set role = 'l1_basic'  where role = 'viewer';
update workspace_invites set role = 'l2_limited' where role = 'member';
update workspace_invites set role = 'l1_basic'  where role = 'viewer';

alter table workspace_members drop constraint if exists workspace_members_role_check;
alter table workspace_members
  add constraint workspace_members_role_check
  check (role in ('admin','l3_full','l2_limited','l1_basic'));

alter table workspace_invites drop constraint if exists workspace_invites_role_check;
alter table workspace_invites alter column role set default 'l2_limited';
alter table workspace_invites
  add constraint workspace_invites_role_check
  check (role in ('admin','l3_full','l2_limited','l1_basic'));

-- role lookup helper for API-side permission checks
create or replace function public.workspace_role(ws uuid)
returns text
language sql
security definer set search_path = public
stable
as $$
  select role from workspace_members
  where workspace_id = ws and user_id = auth.uid();
$$;

-- ============================================================
-- 0011_template_signature.sql
-- ============================================================
-- Template-level closing line + signature (overrides mailbox signature when set)
alter table templates add column if not exists closing_line text;
alter table templates add column if not exists signature_html text;

comment on column templates.closing_line is 'Optional closing line (e.g. "Best," or "Looking forward to hearing from you,")';
comment on column templates.signature_html is 'Template-level email signature (overrides mailbox signature if present)';

-- ============================================================
-- 0012_template_library.sql
-- ============================================================
-- Global template library (workspace_id = null → visible to every workspace).
-- Proven cold/warm frameworks: PAS, value-first, question-led, referral,
-- case-study, follow-up bump, breakup, warm intro, revival, direct meeting ask.
-- Fixed UUIDs so re-running this migration never duplicates rows.

insert into templates (id, workspace_id, name, subject, body, ai_slots) values

('a0000000-0000-4000-8000-000000000001', null,
 'Cold · Problem-Agitate-Solve',
 'quick question about {{company}}',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nMost teams like yours lose hours every week to this — and it compounds quietly.\n\nWe help companies fix it without adding headcount. Worth a 15-minute look next week?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced opening line about this lead or their company.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000002', null,
 'Cold · Value-first',
 'an idea for {{company}}',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nOne idea: {companies your size|teams at your stage} usually see the fastest wins from fixing this one workflow first. Happy to share exactly how — takes 10 minutes.\n\nOpen to it?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced opening line referencing something real about the company.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000003', null,
 'Cold · Question-led',
 'how is {{company}} handling this?',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nCurious — how are you handling this today? Most {{title}}s I speak to say it''s either manual or it''s ignored.\n\nIf it''s on your list, I can show you what''s working for similar teams.',
 '{"ai_icebreaker":{"instruction":"One sharp, factual observation about the lead''s company that sets up the question.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000004', null,
 'Cold · Referral / right person',
 'right person at {{company}}?',
 E'Hi {{first_name}},\n\nI''m looking for whoever owns this at {{company}} — is that you, or someone else on the team?\n\nOne line on why it matters: {{ai_icebreaker}}\n\nIf it''s not you, a quick point in the right direction would be appreciated.',
 '{"ai_icebreaker":{"instruction":"One line tying our offer to something specific about this company.","max_words":25}}'),

('a0000000-0000-4000-8000-000000000005', null,
 'Cold · Case-study proof',
 'how {a similar team|one company} did it',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nWe recently helped a company much like {{company}} get a measurable result here — happy to send the one-pager.\n\nWant it?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced line connecting this lead to the case study topic.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000006', null,
 'Follow-up · Short bump',
 '',
 E'Hi {{first_name}} — floating this back up.\n\nNo pressure either way; if the timing''s wrong, tell me and I''ll close the loop.',
 '{}'),

('a0000000-0000-4000-8000-000000000007', null,
 'Follow-up · New angle',
 '',
 E'Hi {{first_name}},\n\nOne more thought since my last note: the teams that move on this early usually avoid the expensive version of the problem later.\n\nIf that resonates, 15 minutes is all I need. If not, I''ll leave you be.',
 '{}'),

('a0000000-0000-4000-8000-000000000008', null,
 'Breakup · Close the loop',
 '',
 E'Hi {{first_name}},\n\nI''ll take the silence as "not now" and stop here.\n\nIf this becomes a priority later, my door''s open — just reply to this thread and it''ll reach me.',
 '{}'),

('a0000000-0000-4000-8000-000000000009', null,
 'Warm · Intro after connection',
 'good to connect, {{first_name}}',
 E'Hi {{first_name}},\n\nGood to connect {recently|the other day}. You mentioned things were busy on your side — one thing we do that might genuinely help: {{ai_icebreaker}}\n\nIf useful, I''ll send over a short overview. No meeting needed.',
 '{"ai_icebreaker":{"instruction":"One line linking our offer to what this person/company is doing right now.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000010', null,
 'Revival · Old lead re-engage',
 'is this still on the radar?',
 E'Hi {{first_name}},\n\nWe spoke a while back about this and the timing wasn''t right.\n\nThings have moved on our side since — {{ai_icebreaker}}\n\nWorth a fresh look, or shall I close the file?',
 '{"ai_icebreaker":{"instruction":"One line on what is new or improved that is relevant to this lead.","max_words":25}}'),

('a0000000-0000-4000-8000-000000000011', null,
 'Direct · Specific meeting ask',
 '15 minutes {this week|next week}?',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nI''ll keep it simple: 15 minutes, I''ll show you exactly what this looks like for {{company}}, and you decide if it''s worth continuing.\n\nDoes {Tuesday|Thursday} morning work?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced opening line about this lead.","max_words":30}}')

on conflict (id) do nothing;
