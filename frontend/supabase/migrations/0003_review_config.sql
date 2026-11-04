-- The review functions read their config from here, so setup needs no Edge Function secrets.
-- The signing secret stays in Vault and only the service role can read it.

insert into system_settings (key, value) values ('portal_url', '"http://localhost:5173"') on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'review_signing_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'review_signing_secret');
  end if;
end $$;

create function review_config() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'signing_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'review_signing_secret'),
    'portal_url', setting('portal_url') #>> '{}'
  )
$$;
revoke all on function review_config() from public, anon, authenticated;
grant execute on function review_config() to service_role;