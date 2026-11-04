-- Test mode. While environment = 'test', sends reach test contacts only and test data can be reset.
-- go_live() switches to 'production' once and for all, which restores full audit protection.

insert into system_settings (key, value) values ('environment', '"test"') on conflict (key) do nothing;

create function in_test_mode() returns boolean language sql stable security definer set search_path = public as $$
  select setting('environment') = '"test"'::jsonb
$$;

-- The way back is closed for everyone but a database owner who removes this trigger on purpose.
create function guard_environment() returns trigger language plpgsql as $$
begin
  if new.key = 'environment' and old.value = '"production"'::jsonb and new.value <> old.value then
    raise exception 'A live system cannot return to test mode';
  end if;
  return new;
end $$;
create trigger system_settings_environment before update on system_settings for each row execute function guard_environment();

-- Only reset_test_data, in test mode, within its own transaction, gets past this.
create or replace function guard_append_only() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and in_test_mode() and current_setting('app.test_reset', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name;
end $$;

create or replace function set_setting(p_key text, p_value jsonb) returns void language plpgsql security definer set search_path = public as $$
declare before_value jsonb;
begin
  perform require_role('admin');
  if p_key = 'environment' then raise exception 'Use Go live to leave test mode.'; end if;
  select value into before_value from system_settings where key = p_key;
  if not found then raise exception 'Unknown setting %', p_key; end if;
  update system_settings set value = coalesce(p_value, 'null'::jsonb), updated_at = now() where key = p_key;
  perform write_audit('settings.changed', null, null, null, jsonb_build_object('key', p_key, 'from', before_value, 'to', p_value));
end $$;

create or replace function campaign_audience(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tenants; p newsletter_preferences; pl plan_entitlements;
begin
  select * into t from tenants where id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  select * into pl from plan_entitlements where plan_key = t.plan_key;
  -- Anything short of a fully live tenant on a live system reaches test contacts only.
  if in_test_mode() or setting('safe_test_mode') = 'true'::jsonb or t.test_mode or not t.live_send_enabled or pl.signoff_pending then
    return jsonb_build_object('type', 'contact', 'contactIds', to_jsonb(coalesce(p.test_contact_ids, '{}')));
  end if;
  return jsonb_build_object('type', 'tag', 'tagIds', to_jsonb(coalesce(p.allowed_segments, '{}')));
end $$;

create or replace function review_recipient(p_tenant uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare t tenants; p newsletter_preferences;
begin
  select * into t from tenants where id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  if in_test_mode() or setting('safe_test_mode') = 'true'::jsonb or t.test_mode or not t.live_send_enabled then
    return setting('internal_preview_addresses')->>0;
  end if;
  return p.reviewer_email;
end $$;

create or replace function set_live_send(p_tenant uuid, p_enabled boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'operator');
  if p_enabled and in_test_mode() then raise exception 'Live sending is not available in test mode.'; end if;
  if p_enabled and exists (select 1 from jsonb_array_elements(go_live_checklist(p_tenant)) i where i->>'passed' = 'false') then
    raise exception 'Finish the go-live checklist before enabling live sending.';
  end if;
  update tenants set live_send_enabled = p_enabled, test_mode = not p_enabled, updated_at = now() where id = p_tenant;
  perform write_audit('tenant.live_send', p_tenant, null, null, jsonb_build_object('enabled', p_enabled));
end $$;

create function add_test_tenant(p_key text, p_name text, p_division division_t, p_industry text, p_plan text, p_template text, p_cadence cadence_t, p_review review_mode_t, p_newsletter text, p_primary text, p_secondary text, p_offset smallint)
returns void language plpgsql security definer set search_path = public as $$
declare id_ uuid;
begin
  insert into tenants (ghl_location_id, name, division, industry, plan_key, service_areas, opted_in, compliance_acknowledged_at, biweekly_offset, stagger_minutes)
  values ('test-' || p_key, p_name, p_division, p_industry, p_plan, '{US-CO}', true, now(), p_offset, 0) returning id into id_;
  insert into brand_profiles (tenant_id, newsletter_name, primary_color, secondary_color, legal_business_name, from_name, from_email, reply_to, sender_verified, domain_authenticated, phone, website, booking_url, postal_address, local_note)
  values (id_, p_newsletter, p_primary, p_secondary, p_name || ' (test) LLC', p_name, 'news@' || p_key || '.example.com', 'office@' || p_key || '.example.com', true, true, '(555) 010-0100',
    'https://' || p_key || '.example.com', 'https://' || p_key || '.example.com/book', '100 Example Street, Denver, CO 80202', 'Sample local note for testing.');
  insert into newsletter_preferences (tenant_id, template_key, cadence, review_mode, reviewer_name, reviewer_email, allowed_segments, test_contact_ids, ghl_user_id)
  values (id_, p_template, p_cadence, p_review, case when p_review = 'review' then 'Test reviewer' end, case when p_review = 'review' then 'reviewer@' || p_key || '.example.com' end, '{test-tag}', '{test-contact}', 'test-user');
end $$;

create function add_test_edition(p_division division_t, p_industry text, p_week date, p_subject text, p_hero text, p_secondary text, p_regional text) returns void language plpgsql security definer set search_path = public as $$
declare e uuid; h uuid; s uuid; r uuid;
begin
  insert into content_items (division, industry, headline, teaser, body, cta_label, status, approved_at) values
    (p_division, p_industry, p_hero, 'Sample teaser for testing.', 'Sample article text for testing.' || chr(10) || chr(10) || 'A second paragraph shows spacing.', 'Book now', 'approved', now()) returning id into h;
  insert into content_items (division, industry, headline, teaser, body, status, approved_at) values
    (p_division, p_industry, p_secondary, 'Sample teaser for testing.', 'Sample article text.', 'approved', now()) returning id into s;
  insert into editions (division, industry, publication_week, subject, preview_text, status, central_approved_at, approved_snapshot)
  values (p_division, p_industry, p_week, p_subject, 'Sample preview text', 'approved', now(), '[]') returning id into e;
  insert into edition_items (edition_id, content_item_id, slot, position) values (e, h, 'hero', 0), (e, s, 'secondary', 1);
  if p_regional is not null then
    insert into content_items (division, industry, regions, headline, teaser, body, status, approved_at) values
      (p_division, p_industry, '{US-CO}', p_regional, 'Sample Colorado-only teaser.', 'Sample regional text.', 'approved', now()) returning id into r;
    insert into edition_items (edition_id, content_item_id, slot, position) values (e, r, 'secondary', 2);
  end if;
end $$;

create function seed_test_data() returns jsonb language plpgsql security definer set search_path = public as $$
declare week date := (date_trunc('week', now() at time zone 'UTC') + interval '7 days')::date;
begin
  perform require_role('admin');
  if not in_test_mode() then raise exception 'Test data can only be loaded in test mode.'; end if;
  if exists (select 1 from tenants) or exists (select 1 from editions) then raise exception 'Reset first: this project already has data.'; end if;
  perform add_test_tenant('equinox', 'Equinox Roofing', 'hsg', 'roofing', 'hsg_growth', 'protection_report', 'weekly', 'review', 'The Equinox Home Protection Report', '#14344f', '#d9822b', 0::smallint);
  perform add_test_tenant('summit', 'Summit Peak Roofing', 'hsg', 'roofing', 'hsg_growth', 'tips_insights', 'weekly', 'auto', 'Summit Peak Homeowner Tips', '#3b2f63', '#1d8a7a', 0::smallint);
  perform add_test_tenant('timber', 'Timber Ridge HVAC', 'hsg', 'hvac', 'hsg_freedom', 'seasonal_guide', 'weekly', 'auto', 'Timber Ridge Comfort Guide', '#22543d', '#c05621', 0::smallint);
  perform add_test_tenant('craft', 'Craft Mountain Brewery', 'hospitality', 'brewery', 'hospitality_pilot', 'premium_magazine', 'weekly', 'auto', 'The Craft Mountain Taproom', '#5b3a1e', '#b7791f', 0::smallint);
  perform add_test_edition('hsg', 'roofing', week, 'Test: storm-season roof check', 'Sample: what to check on your roof after a storm', 'Sample: why clean gutters protect your roof', 'Sample: a note for Colorado homeowners');
  perform add_test_edition('hsg', 'hvac', week, 'Test: get ready for winter', 'Sample: get your furnace ready for winter', 'Sample: when to replace a filter', null);
  perform add_test_edition('hospitality', 'brewery', week, 'Test: on tap this month', 'Sample: what is on tap this month', 'Sample: community night', null);
  perform write_audit('test.seeded', null, null, null);
  return jsonb_build_object('tenants', 4, 'editions', 3);
end $$;

-- Brings rendered campaigns forward so a test does not have to wait for the real send day.
create function test_send_now() returns jsonb language plpgsql security definer set search_path = public as $$
declare approved int; review int;
begin
  perform require_role('admin');
  if not in_test_mode() then raise exception 'This is only available in test mode.'; end if;
  update campaign_instances set scheduled_at = now() + interval '15 minutes', next_attempt_at = null where status = 'APPROVED_FOR_SEND';
  get diagnostics approved = row_count;
  update campaign_instances set review_deadline = now() + interval '30 minutes', scheduled_at = now() + interval '45 minutes', review_invite_requested_at = now(), review_invite_sent_at = null where status = 'CLIENT_REVIEW_PENDING';
  get diagnostics review = row_count;
  perform write_audit('test.send_now', null, null, null, jsonb_build_object('approved', approved, 'review', review));
  return jsonb_build_object('approved', approved, 'review', review);
end $$;

create function reset_test_data(p_confirm text) returns jsonb language plpgsql security definer set search_path = public as $$
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
  delete from review_tokens;
  delete from approval_events;
  delete from campaign_metrics;
  delete from campaign_instances;
  delete from edition_items;
  delete from editions;
  delete from content_items;
  delete from tenant_users;
  delete from tenants; -- brand profiles and preferences cascade
  delete from pause_switches;
  delete from ops_alerts;
  delete from ghl_api_usage;
  delete from audit_log;
  perform set_config('app.test_reset', 'off', true);

  update system_settings set value = 'true', updated_at = now() where key in ('ghl_dry_run', 'safe_test_mode');
  insert into audit_log (actor, action, details) values (actor, 'test.reset', '{}');
  return jsonb_build_object('ok', true);
end $$;

create function go_live(p_confirm text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin');
  if p_confirm is distinct from 'GO LIVE' then raise exception 'Type GO LIVE to confirm.'; end if;
  if not in_test_mode() then raise exception 'This system is already live.'; end if;
  if exists (select 1 from tenants where ghl_location_id like 'test-%') then raise exception 'Reset the test data before going live.'; end if;
  update system_settings set value = '"production"', updated_at = now() where key = 'environment';
  perform write_audit('system.go_live', null, null, null);
end $$;

do $$
declare f text;
begin
  foreach f in array array['in_test_mode()', 'guard_environment()', 'seed_test_data()', 'test_send_now()', 'reset_test_data(text)', 'go_live(text)',
    'add_test_tenant(text, text, division_t, text, text, text, cadence_t, review_mode_t, text, text, text, smallint)', 'add_test_edition(division_t, text, date, text, text, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
grant execute on function seed_test_data(), test_send_now(), reset_test_data(text), go_live(text) to authenticated;