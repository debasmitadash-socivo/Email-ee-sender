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
