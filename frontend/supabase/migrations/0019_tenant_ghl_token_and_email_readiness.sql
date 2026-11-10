-- 1. Each sub-account's GoHighLevel token can be entered in the app. It is stored only in Vault and never shown again.
-- 2. Email workflows pause quietly while email setup is incomplete, instead of failing every few minutes.

alter table tenants add column ghl_token_saved_at timestamptz;

-- Whether a token is stored for this sub-account (under its own secret name, or the older ghl_<location> name).
create function tenant_ghl_connected(p_tenant uuid) returns boolean language sql stable security definer set search_path = public, vault as $$
  select exists (
    select 1 from tenants t join vault.secrets s on s.name = coalesce(t.ghl_token_secret, 'ghl_' || t.ghl_location_id)
    where t.id = p_tenant
  )
$$;

-- Tokens entered before this screen existed count as saved.
update tenants t set ghl_token_saved_at = now() where tenant_ghl_connected(t.id) and ghl_token_saved_at is null;

create function set_tenant_ghl_token(p_tenant uuid, p_token text) returns void language plpgsql security definer set search_path = public, vault as $$
declare t tenants; secret_name text; secret_id uuid;
begin
  perform require_role('admin', 'operator');
  select * into t from tenants where id = p_tenant for update;
  if not found then raise exception 'This sub-account no longer exists.'; end if;
  if coalesce(trim(p_token), '') = '' then raise exception 'Paste the GoHighLevel private integration token.'; end if;
  if length(trim(p_token)) < 20 or trim(p_token) ~ '\s' then raise exception 'That does not look like a GoHighLevel token. Copy it again.'; end if;
  -- Keep using an existing secret (including the older ghl_<location> name); otherwise make one that never
  -- changes, so editing the location ID later does not lose the token.
  secret_name := coalesce(t.ghl_token_secret,
    case when exists (select 1 from vault.secrets where name = 'ghl_' || t.ghl_location_id) then 'ghl_' || t.ghl_location_id end,
    'ghl_tenant_' || t.id);
  select id into secret_id from vault.secrets where name = secret_name;
  if secret_id is null then perform vault.create_secret(trim(p_token), secret_name);
  else perform vault.update_secret(secret_id, trim(p_token)); end if;
  update tenants set ghl_token_secret = secret_name, ghl_token_saved_at = now() where id = p_tenant;
  perform write_audit('tenant.ghl_token_saved', p_tenant, null, null, jsonb_build_object('name', t.name));
end $$;

-- For the ghl-check Edge Function: the location and token to test, only with the service role.
create function tenant_ghl_check_target(p_tenant uuid) returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object('location_id', t.ghl_location_id,
    'token', (select decrypted_secret from vault.decrypted_secrets where name = coalesce(t.ghl_token_secret, 'ghl_' || t.ghl_location_id)))
  from tenants t where t.id = p_tenant
$$;

create function log_tenant_ghl_check(p_tenant uuid, p_ok boolean, p_message text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'operator');
  perform write_audit('tenant.ghl_checked', p_tenant, null, null, jsonb_build_object('ok', p_ok, 'message', left(coalesce(p_message, ''), 300)));
end $$;

-- The go-live checklist gains "GoHighLevel connected". Everything else is unchanged.
create or replace function go_live_checklist(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tenants; b brand_profiles; p newsletter_preferences; pl plan_entitlements;
begin
  if not (is_staff() or p_tenant in (select my_tenants()) or auth.uid() is null) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into t from tenants where id = p_tenant;
  select * into b from brand_profiles where tenant_id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  select * into pl from plan_entitlements where plan_key = t.plan_key;
  return jsonb_build_array(
    jsonb_build_object('item', 'identity', 'label', 'Business identity and legal name', 'passed', coalesce(b.legal_business_name, '') <> ''),
    jsonb_build_object('item', 'postal', 'label', 'Postal address on file', 'passed', coalesce(b.postal_address, '') <> ''),
    jsonb_build_object('item', 'sender', 'label', 'Verified sender identity', 'passed', coalesce(b.sender_verified, false) and coalesce(b.from_email, '') <> ''),
    jsonb_build_object('item', 'domain', 'label', 'Sending domain authenticated', 'passed', coalesce(b.domain_authenticated, false)),
    jsonb_build_object('item', 'title', 'label', 'Newsletter title set', 'passed', coalesce(b.newsletter_name, '') <> ''),
    jsonb_build_object('item', 'template', 'label', 'Template allowed by plan', 'passed', exists (select 1 from plan_templates pt where pt.plan_key = t.plan_key and pt.template_key = p.template_key)),
    jsonb_build_object('item', 'reviewer', 'label', 'Reviewer set (review mode only)', 'passed', p.review_mode <> 'review' or coalesce(p.reviewer_email, '') <> ''),
    jsonb_build_object('item', 'segment', 'label', 'Contact segment selected', 'passed', cardinality(p.allowed_segments) > 0),
    jsonb_build_object('item', 'ghl_user', 'label', 'GHL user id set', 'passed', coalesce(p.ghl_user_id, '') <> ''),
    jsonb_build_object('item', 'ghl_connected', 'label', 'GoHighLevel connected', 'passed', tenant_ghl_connected(p_tenant)),
    jsonb_build_object('item', 'opt_in', 'label', 'Tenant opted in', 'passed', t.opted_in),
    jsonb_build_object('item', 'compliance', 'label', 'Compliance acknowledged', 'passed', t.compliance_acknowledged_at is not null),
    jsonb_build_object('item', 'plan_terms', 'label', 'Plan terms signed off', 'passed', not pl.signoff_pending),
    jsonb_build_object('item', 'test_email', 'label', 'Test email passed', 'passed', t.test_email_passed_at is not null)
  );
end $$;

-- The sender as workflows 04, 05 and 09 see it. Instead of failing while setup is incomplete, it says
-- ready = false and why; the workflows then skip sending and try again on their next run.
create or replace function notification_sender() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  email text := setting('notification_from_email') #>> '{}';
  name text := coalesce(setting('notification_from_name') #>> '{}', 'Archimedes');
  channel text := coalesce(setting('notification_channel') #>> '{}', 'smtp');
  problem text;
begin
  if coalesce(email, '') = '' then
    problem := 'The Sender email under Settings is empty.';
  elsif channel = 'ghl' and coalesce(setting('notification_ghl') ->> 'location_id', '') = '' then
    problem := 'Notification emails are set to go through GoHighLevel, but no GoHighLevel location is saved.';
  elsif channel = 'smtp' and coalesce(setting('smtp_config'), 'null'::jsonb) = 'null'::jsonb then
    problem := 'Notification emails are set to go through an email server, but none is saved.';
  end if;
  return jsonb_build_object('ready', problem is null, 'problem', problem, 'channel', channel,
    'from_email', email, 'from_name', name, 'from', case when email is null then null else name || ' <' || email || '>' end);
end $$;

revoke all on function tenant_ghl_connected(uuid), set_tenant_ghl_token(uuid, text), tenant_ghl_check_target(uuid), log_tenant_ghl_check(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function tenant_ghl_connected(uuid), set_tenant_ghl_token(uuid, text), tenant_ghl_check_target(uuid), log_tenant_ghl_check(uuid, boolean, text) to service_role;
grant execute on function tenant_ghl_connected(uuid), set_tenant_ghl_token(uuid, text), log_tenant_ghl_check(uuid, boolean, text) to authenticated;
