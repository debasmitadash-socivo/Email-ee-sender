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
