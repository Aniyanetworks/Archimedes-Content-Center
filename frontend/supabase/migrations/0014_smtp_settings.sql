-- The email server (SMTP) used by n8n for review invites and alerts, managed from Pause and safety.
-- The password is never stored here: it goes straight into n8n's encrypted credential store through
-- the smtp-settings Edge Function. This setting only keeps what the screen shows (server, port, user).

insert into system_settings (key, value) values ('smtp_config', 'null'::jsonb) on conflict (key) do nothing;

-- Called by the Edge Function with the admin's own token, so the role is checked again and the
-- audit log names the admin.
create function save_smtp_config(p_config jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin');
  if p_config ? 'password' then raise exception 'The password must not be stored in the database'; end if;
  update system_settings set value = p_config, updated_at = now() where key = 'smtp_config';
  perform write_audit('settings.smtp_saved', null, null, null,
    jsonb_build_object('host', p_config->>'host', 'port', p_config->'port', 'user', p_config->>'user', 'secure', p_config->'secure'));
end $$;

create function log_smtp_event(p_action text, p_details jsonb default '{}') returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin');
  if p_action not in ('smtp.tested', 'email_workflows.on', 'email_workflows.off') then raise exception 'Unknown event'; end if;
  perform write_audit(p_action, null, null, null, coalesce(p_details, '{}'));
end $$;

revoke all on function save_smtp_config(jsonb), log_smtp_event(text, jsonb) from public, anon, authenticated;
grant execute on function save_smtp_config(jsonb), log_smtp_event(text, jsonb) to service_role, authenticated;
