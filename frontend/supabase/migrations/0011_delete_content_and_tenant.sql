-- Delete stories and sub-accounts (tenants) that were never used.
-- Anything that has been approved, sent or reviewed stays, so sent newsletters can always be traced.
-- Audit entries are kept (audit_log has no foreign keys), and a final entry records each deletion.

create function content_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare c content_items;
begin
  perform require_role('admin', 'editor');
  select * into c from content_items where id = p_id for update;
  if not found then raise exception 'This story no longer exists.'; end if;
  if c.status in ('approved', 'retired') or c.approved_at is not null then
    raise exception 'An approved story cannot be deleted. Retire it instead.';
  end if;
  if exists (select 1 from edition_items where content_item_id = p_id) then
    raise exception 'This story is used in an edition. Remove it from the edition first.';
  end if;
  delete from content_items where id = p_id;
  perform write_audit('content.deleted', null, null, null,
    jsonb_build_object('content_id', c.content_id, 'version', c.version, 'headline', c.headline, 'status', c.status));
end $$;

create function tenant_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare t tenants;
begin
  perform require_role('admin', 'operator');
  select * into t from tenants where id = p_id for update;
  if not found then raise exception 'This sub-account no longer exists.'; end if;
  if t.live_send_enabled then raise exception 'Turn off live sending before deleting this sub-account.'; end if;
  if exists (select 1 from campaign_instances where tenant_id = p_id) or exists (select 1 from approval_events where tenant_id = p_id) then
    raise exception 'This sub-account already has newsletters, so it cannot be deleted. Pause it instead.';
  end if;
  delete from pause_switches where scope = 'tenant' and scope_value = p_id::text;
  -- brand_profiles, newsletter_preferences and tenant_users go with it (on delete cascade).
  delete from tenants where id = p_id;
  perform write_audit('tenant.deleted', p_id, null, null,
    jsonb_build_object('name', t.name, 'ghl_location_id', t.ghl_location_id, 'industry', t.industry));
end $$;

revoke all on function content_delete(uuid), tenant_delete(uuid) from public, anon, authenticated;
grant execute on function content_delete(uuid), tenant_delete(uuid) to service_role, authenticated;
