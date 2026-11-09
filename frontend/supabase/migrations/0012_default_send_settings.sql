-- Sensible starting values for the two sending settings, so dispatch is not blocked on a fresh install.
-- Only empty settings are filled; a value an admin already saved is never overwritten.
--   daily_send_cap: most campaigns handed to GHL per UTC day (one campaign = one sub-account's newsletter).
--   cost_per_1000_emails_usd: GHL's standard email rate, used only for the dashboard cost estimate.

do $$
declare k text; v jsonb;
begin
  for k, v in select * from (values ('daily_send_cap', '500'::jsonb), ('cost_per_1000_emails_usd', '0.675'::jsonb)) as d(key, value) loop
    update system_settings set value = v, updated_at = now() where key = k and (value is null or value = 'null'::jsonb);
    if found then
      perform write_audit('settings.changed', null, null, null, jsonb_build_object('key', k, 'from', null, 'to', v, 'reason', 'default value'));
    end if;
  end loop;
end $$;
