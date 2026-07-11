-- Workspace members with role-based access control
create type workspace_role as enum ('admin', 'l3_full', 'l2_limited', 'l1_basic');

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'l1_basic',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_members_workspace_idx on workspace_members(workspace_id);
create index workspace_members_user_idx on workspace_members(user_id);
create index workspace_members_role_idx on workspace_members(role);

-- RLS: Users can see members of their workspaces; only admins can modify
alter table workspace_members enable row level security;

create policy "users_read_workspace_members" on workspace_members
  for select using (
    workspace_id in (select id from workspaces where id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    ))
  );

create policy "admins_manage_workspace_members" on workspace_members
  for all using (
    workspace_id in (select id from workspaces where id in (
      select workspace_id from workspace_members
      where user_id = auth.uid() and role = 'admin'
    ))
  );
