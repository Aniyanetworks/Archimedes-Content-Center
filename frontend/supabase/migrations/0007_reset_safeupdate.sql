-- Supabase's pg_safeupdate rejects a DELETE without a WHERE clause on API calls, so reset failed
-- live with "DELETE requires a WHERE clause". Each delete now says explicitly that it clears the table.

create or replace function reset_test_data(p_confirm text) returns jsonb language plpgsql security definer set search_path = public as $$
declare stranded int; actor text := current_actor();
begin
  perform require_role('admin');
  if not in_test_mode() then raise exception 'A live system cannot be reset.'; end if;
  if p_confirm is distinct from 'RESET' then raise exception 'Type RESET to confirm.'; end if;
  -- Forgetting a campaign that GHL still holds would leave it able to send with nothing tracking it.
  select count(*) into stranded from campaign_instances where ghl_campaign_id is not null and ghl_campaign_id not like 'dry-run-%' and status <> 'SENT';
  if stranded > 0 then raise exception '% campaign(s) still exist in GHL. Cancel them and let workflow 08 delete them before resetting.', stranded; end if;
  if exists (select 1 from campaign_instances where status = 'SENDING') then raise exception 'A campaign is sending. Wait for it to finish.'; end if;

  perform set_config('app.test_reset', 'on', true);
  delete from review_tokens where true;
  delete from approval_events where true;
  delete from campaign_metrics where true;
  delete from campaign_instances where true;
  delete from edition_items where true;
  delete from editions where true;
  delete from content_items where true;
  delete from tenant_users where true;
  delete from tenants where true; -- brand profiles and preferences cascade
  delete from pause_switches where true;
  delete from ops_alerts where true;
  delete from ghl_api_usage where true;
  delete from audit_log where true;
  perform set_config('app.test_reset', 'off', true);

  update system_settings set value = 'true', updated_at = now() where key in ('ghl_dry_run', 'safe_test_mode');
  insert into audit_log (actor, action, details) values (actor, 'test.reset', '{}');
  return jsonb_build_object('ok', true);
end $$;
