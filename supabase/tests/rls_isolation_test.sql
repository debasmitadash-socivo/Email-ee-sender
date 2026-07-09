-- RLS isolation test: proves user A cannot read workspace B's rows.
-- Run with: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation_test.sql
-- (or paste into the Supabase SQL editor). Uses transaction-local role
-- switching to simulate two authenticated users; rolls back at the end.

begin;

-- two fake auth users
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.local')
on conflict do nothing;
insert into public.users (id, email, name) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.local', 'Alice'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.local', 'Bob')
on conflict do nothing;

-- two workspaces, one member each
insert into workspaces (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a1', 'WS Alice', 'ws-alice-test'),
  ('00000000-0000-0000-0000-0000000000b1', 'WS Bob', 'ws-bob-test');
insert into workspace_members values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'admin');

-- a lead in each workspace
insert into leads (workspace_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'lead-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'lead-b@example.com');

-- become Alice
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare n int;
begin
  -- Alice sees exactly her own workspace
  select count(*) into n from workspaces;
  if n <> 1 then raise exception 'FAIL: Alice sees % workspaces, expected 1', n; end if;

  -- Alice sees only her own lead
  select count(*) into n from leads;
  if n <> 1 then raise exception 'FAIL: Alice sees % leads, expected 1', n; end if;

  select count(*) into n from leads where workspace_id = '00000000-0000-0000-0000-0000000000b1';
  if n <> 0 then raise exception 'FAIL: Alice can read workspace B leads'; end if;

  -- Alice cannot insert into workspace B
  begin
    insert into leads (workspace_id, email) values ('00000000-0000-0000-0000-0000000000b1', 'evil@example.com');
    raise exception 'FAIL: Alice inserted into workspace B';
  exception when insufficient_privilege or check_violation then
    null; -- expected: RLS blocked it
  end;

  -- provider_keys is service-role only
  begin
    select count(*) into n from provider_keys;
    if n <> 0 then raise exception 'FAIL: authenticated user can read provider_keys'; end if;
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'PASS: RLS workspace isolation holds';
end $$;

rollback;
