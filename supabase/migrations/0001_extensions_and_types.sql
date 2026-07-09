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
