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
