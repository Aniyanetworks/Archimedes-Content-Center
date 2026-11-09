-- Where the smtp-settings Edge Function finds n8n: three Vault secrets, readable only with the service role.
--   n8n_base_url            e.g. https://n8n.example.com
--   n8n_api_key             an n8n API key
--   n8n_email_workflow_ids  comma-separated ids of the workflows that send email (04, 05, 09)
-- Create them once with vault.create_secret(value, name); Edge Function secrets of the same names, if set, take priority.

create function n8n_config() returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'base_url', (select decrypted_secret from vault.decrypted_secrets where name = 'n8n_base_url'),
    'api_key', (select decrypted_secret from vault.decrypted_secrets where name = 'n8n_api_key'),
    'email_workflow_ids', (select decrypted_secret from vault.decrypted_secrets where name = 'n8n_email_workflow_ids')
  )
$$;

revoke all on function n8n_config() from public, anon, authenticated;
grant execute on function n8n_config() to service_role;
