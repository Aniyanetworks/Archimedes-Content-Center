-- GoHighLevel is the default way to send notification emails. SMTP stays available as the alternative.
-- Only an install that never set up SMTP and never chose a method is switched, so a real choice is never overridden.

do $$
begin
  if setting('notification_channel') = '"smtp"'::jsonb
     and coalesce(setting('smtp_config'), 'null'::jsonb) = 'null'::jsonb
     and not exists (select 1 from audit_log where action = 'settings.notification_channel') then
    update system_settings set value = '"ghl"'::jsonb, updated_at = now() where key = 'notification_channel';
    perform write_audit('settings.notification_channel', null, null, null, jsonb_build_object('from', 'smtp', 'to', 'ghl', 'reason', 'default value'));
  end if;
end $$;
