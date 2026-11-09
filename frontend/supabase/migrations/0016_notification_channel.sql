-- Notification emails (review invites, missed deadlines, ops alerts) can go out through an SMTP server
-- or through GoHighLevel. Admins choose on Pause and safety; both can be set up at the same time.
-- The GHL token lives only in Vault (secret 'ghl_notify_token'); settings keep what the screen shows.

insert into system_settings (key, value) values
  ('notification_channel', '"smtp"'::jsonb),
  ('notification_ghl', 'null'::jsonb)
on conflict (key) do nothing;

-- The sender as workflows 04, 05 and 09 see it, now including how to send.
create or replace function notification_sender() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  email text := setting('notification_from_email') #>> '{}';
  name text := coalesce(setting('notification_from_name') #>> '{}', 'Archimedes');
  channel text := coalesce(setting('notification_channel') #>> '{}', 'smtp');
begin
  if email is null or email = '' then
    raise exception 'Set the notification sender email under Pause and safety before email workflows can run.';
  end if;
  if channel = 'ghl' and coalesce(setting('notification_ghl') ->> 'location_id', '') = '' then
    raise exception 'Notification emails are set to go through GoHighLevel, but no GoHighLevel location is saved.';
  end if;
  return jsonb_build_object('from_email', email, 'from_name', name, 'from', name || ' <' || email || '>', 'channel', channel);
end $$;

create function set_notification_channel(p_channel text) returns void language plpgsql security definer set search_path = public as $$
declare before_value text := setting('notification_channel') #>> '{}';
begin
  perform require_role('admin');
  if p_channel not in ('smtp', 'ghl') then raise exception 'Choose SMTP or GoHighLevel.'; end if;
  if p_channel = 'ghl' and coalesce(setting('notification_ghl') ->> 'location_id', '') = '' then
    raise exception 'Save the GoHighLevel location and token first.';
  end if;
  update system_settings set value = to_jsonb(p_channel), updated_at = now() where key = 'notification_channel';
  perform write_audit('settings.notification_channel', null, null, null, jsonb_build_object('from', before_value, 'to', p_channel));
end $$;

-- Saves the location and stores the token in Vault. A null token keeps the one already saved.
create function set_notification_ghl(p_location text, p_token text default null) returns void language plpgsql security definer set search_path = public, vault as $$
declare loc text := trim(coalesce(p_location, '')); secret_id uuid;
begin
  perform require_role('admin');
  if loc = '' or loc !~ '^[A-Za-z0-9]{10,40}$' then raise exception 'Enter the GoHighLevel location ID (letters and numbers only).'; end if;
  select id into secret_id from vault.secrets where name = 'ghl_notify_token';
  if p_token is not null and trim(p_token) <> '' then
    if secret_id is null then perform vault.create_secret(trim(p_token), 'ghl_notify_token');
    else perform vault.update_secret(secret_id, trim(p_token)); end if;
  elsif secret_id is null then
    raise exception 'Paste the GoHighLevel private integration token.';
  end if;
  update system_settings set value = jsonb_build_object('location_id', loc, 'token_saved', true, 'updated_at', now()), updated_at = now()
  where key = 'notification_ghl';
  perform write_audit('settings.notification_ghl', null, null, null,
    jsonb_build_object('location_id', loc, 'token_changed', p_token is not null and trim(p_token) <> ''));
end $$;

-- For the notify-ghl Edge Function only.
create function notification_ghl_config() returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'location_id', setting('notification_ghl') ->> 'location_id',
    'token', (select decrypted_secret from vault.decrypted_secrets where name = 'ghl_notify_token'),
    'from_email', setting('notification_from_email') #>> '{}',
    'from_name', coalesce(setting('notification_from_name') #>> '{}', 'Archimedes')
  )
$$;

create function log_notification_test(p_channel text, p_ok boolean, p_to text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin');
  perform write_audit('settings.notification_test', null, null, null, jsonb_build_object('channel', p_channel, 'ok', p_ok, 'to', p_to));
end $$;

revoke all on function set_notification_channel(text), set_notification_ghl(text, text), notification_ghl_config(), log_notification_test(text, boolean, text)
  from public, anon, authenticated;
grant execute on function set_notification_channel(text), set_notification_ghl(text, text), notification_ghl_config(), log_notification_test(text, boolean, text) to service_role;
grant execute on function set_notification_channel(text), set_notification_ghl(text, text), log_notification_test(text, boolean, text) to authenticated;
