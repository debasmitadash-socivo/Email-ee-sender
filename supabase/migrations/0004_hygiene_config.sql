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
