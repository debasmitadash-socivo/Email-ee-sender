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
