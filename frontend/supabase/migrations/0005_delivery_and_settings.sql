-- Delivery checks and editable notification settings.
-- GHL reports a campaign as "sent" even when every email was rejected (6 November 2026 test:
-- status sent, delivered 0 of 1, "5.7.1 Rejected due to high probability of spam"), so sent is
-- not proof of delivery. Workflow 11 reads GHL's counts and records what really happened.

insert into system_settings (key, value) values
  ('notification_from_email', 'null'),        -- sender for review invites and alerts; workflows stop until set
  ('notification_from_name', '"Archimedes"'),
  ('delivery_check_after_minutes', '30'),     -- wait this long after sending before judging delivery
  ('delivery_recheck_hours', '24')            -- keep re-checking partial or queued deliveries this long
on conflict (key) do nothing;

alter table campaign_instances
  add column delivery_state text not null default 'unchecked' check (delivery_state in ('unchecked', 'delivered', 'partial', 'failed', 'unverified')),
  add column delivery_checked_at timestamptz,
  add column delivery_detail jsonb;

create function notification_sender() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare email text := setting('notification_from_email') #>> '{}'; name text := coalesce(setting('notification_from_name') #>> '{}', 'Archimedes');
begin
  if email is null or email = '' then
    raise exception 'Set the notification sender email under Pause and safety before email workflows can run.';
  end if;
  return jsonb_build_object('from_email', email, 'from_name', name, 'from', name || ' <' || email || '>');
end $$;

create function list_campaigns_to_check_delivery(p_limit int default 100) returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('campaign_id', c.id, 'ghl_location_id', t.ghl_location_id, 'ghl_campaign_id', c.ghl_campaign_id, 'idempotency_key', c.idempotency_key)
  from campaign_instances c join tenants t on t.id = c.tenant_id
  where c.status = 'SENT' and c.ghl_campaign_id is not null and c.ghl_campaign_id not like 'dry-run-%'
    and c.sent_at <= now() - make_interval(mins => coalesce((setting('delivery_check_after_minutes') #>> '{}')::int, 30))
    and (c.delivery_state = 'unchecked' or (c.delivery_state = 'partial' and c.sent_at > now() - make_interval(hours => coalesce((setting('delivery_recheck_hours') #>> '{}')::int, 24))))
    and c.sent_at > now() - interval '7 days'
  order by c.sent_at limit p_limit
$$;

create function record_delivery_check(p_id uuid, p_reachable boolean, p_found boolean, p_total int default null, p_delivered int default null, p_queued int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c campaign_instances; recheck interval := make_interval(hours => coalesce((setting('delivery_recheck_hours') #>> '{}')::int, 24));
  still_early boolean; total int := coalesce(p_total, 0); ok int := coalesce(p_delivered, 0); state text; reason text;
begin
  select * into c from campaign_instances where id = p_id for update;
  if c.status <> 'SENT' then return jsonb_build_object('ok', false, 'reason', 'not_sent'); end if;
  still_early := c.sent_at > now() - recheck;
  if not coalesce(p_reachable, false) then
    return jsonb_build_object('ok', false, 'reason', 'unreachable'); -- try again on the next run
  end if;

  if not coalesce(p_found, false) or total = 0 then
    if still_early then
      update campaign_instances set delivery_checked_at = now() where id = p_id;
      return jsonb_build_object('ok', true, 'state', 'waiting');
    end if;
    state := 'unverified'; reason := 'delivery_unverified';
  elsif coalesce(p_queued, 0) > 0 and still_early then
    update campaign_instances set delivery_checked_at = now(), delivery_detail = jsonb_build_object('total', total, 'delivered', ok, 'queued', p_queued) where id = p_id;
    return jsonb_build_object('ok', true, 'state', 'waiting');
  elsif ok = 0 then
    state := 'failed'; reason := format('delivery_failed: 0 of %s delivered', total);
  elsif ok < total then
    state := 'partial'; reason := format('delivered %s of %s', ok, total);
  else
    state := 'delivered'; reason := null;
  end if;

  update campaign_instances set delivery_state = state, delivery_checked_at = now(), status_reason = reason,
    delivery_detail = jsonb_build_object('total', total, 'delivered', ok, 'queued', coalesce(p_queued, 0))
  where id = p_id;
  insert into campaign_metrics as m (campaign_id, tenant_id, recipients, delivered, raw)
  values (p_id, c.tenant_id, total, ok, jsonb_build_object('source', 'ghl_schedule_stats', 'queued', coalesce(p_queued, 0)))
  on conflict (campaign_id) do update set recipients = excluded.recipients, delivered = excluded.delivered, raw = excluded.raw, updated_at = now();
  perform write_audit('delivery.' || state, c.tenant_id, p_id, c.edition_id, jsonb_build_object('total', total, 'delivered', ok, 'queued', p_queued));

  if state = 'failed' then
    perform raise_alert('delivery_failed', format('GHL accepted the campaign but delivered 0 of %s emails. Check the sending domain and GHL email logs.', total), 'critical', p_id, c.tenant_id);
  elsif state = 'partial' and not still_early then
    perform raise_alert('delivery_partial', format('Only %s of %s emails were delivered.', ok, total), 'warning', p_id, c.tenant_id);
  elsif state = 'unverified' then
    perform raise_alert('delivery_unverified', 'GHL returned no delivery numbers for this campaign.', 'warning', p_id, c.tenant_id);
  end if;
  return jsonb_build_object('ok', true, 'state', state);
end $$;

-- The dashboard shows the delivery result next to the campaign status.
create or replace view campaign_overview with (security_invoker = true) as
select c.id, c.tenant_id, t.name as tenant_name, t.timezone, t.division, t.industry, t.plan_key, p.review_mode, c.edition_id, e.subject as edition_subject, e.publication_week,
  c.edition_version, c.status, c.status_reason, c.scheduled_at, c.sent_at, c.review_deadline, c.ghl_campaign_id, c.dispatch_state, c.dispatch_attempts, c.last_error, c.rendered_html_hash,
  c.idempotency_key, c.dead_lettered_at, c.cancel_requested_at, c.delivery_state
from campaign_instances c join tenants t on t.id = c.tenant_id join editions e on e.id = c.edition_id left join newsletter_preferences p on p.tenant_id = c.tenant_id;

do $$
declare f text;
begin
  foreach f in array array['notification_sender()', 'list_campaigns_to_check_delivery(int)', 'record_delivery_check(uuid, boolean, boolean, int, int, int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
