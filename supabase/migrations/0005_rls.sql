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
