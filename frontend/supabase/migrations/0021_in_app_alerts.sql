-- Problem alerts inside the app. The same alerts workflow 09 emails are shown under a bell in the top bar,
-- until someone marks them done. Emailing them (claimed_at) and marking them done (resolved_at) are separate.

alter table ops_alerts add column resolved_at timestamptz, add column resolved_by text;
create index ops_alerts_open_in_app on ops_alerts (created_at desc) where resolved_at is null;

-- Mark one alert done, or all open ones when p_id is null.
create function resolve_ops_alerts(p_id bigint default null) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_role('admin', 'operator');
  update ops_alerts set resolved_at = now(), resolved_by = current_actor()
  where resolved_at is null and (p_id is null or id = p_id);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function resolve_ops_alerts(bigint) from public, anon, authenticated;
grant execute on function resolve_ops_alerts(bigint) to service_role, authenticated;
