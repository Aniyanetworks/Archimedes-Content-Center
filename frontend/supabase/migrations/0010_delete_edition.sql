-- Delete an edition that never went anywhere: a draft, a rejected edition, or one still awaiting approval.
-- Once an edition has been approved it has campaigns and approval history, so it stays; cancel its campaigns instead.
-- Its audit entries stay too (audit_log has no foreign key), and a final entry records the deletion.

create function edition_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare e editions;
begin
  perform require_role('admin', 'editor');
  select * into e from editions where id = p_id for update;
  if not found then raise exception 'This edition no longer exists.'; end if;
  if e.status = 'approved' or e.central_approved_at is not null
     or exists (select 1 from campaign_instances where edition_id = p_id)
     or exists (select 1 from approval_events where edition_id = p_id) then
    raise exception 'An approved edition cannot be deleted. Cancel its campaigns on the dashboard instead.';
  end if;
  delete from edition_items where edition_id = p_id;
  delete from editions where id = p_id;
  perform write_audit('edition.deleted', null, null, p_id,
    jsonb_build_object('industry', e.industry, 'week', e.publication_week, 'subject', e.subject, 'status', e.status));
end $$;

revoke all on function edition_delete(uuid) from public, anon, authenticated;
grant execute on function edition_delete(uuid) to service_role, authenticated;
