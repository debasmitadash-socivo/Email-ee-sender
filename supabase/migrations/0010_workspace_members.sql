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
