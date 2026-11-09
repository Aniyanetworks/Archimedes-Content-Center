-- Clear the audit log while testing. A live system's audit log stays permanent, as before.
-- Admin only, with a typed confirmation. One entry is left behind saying who cleared it and how many entries went.

create function clear_audit_log(p_confirm text) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor text := current_actor(); removed int;
begin
  perform require_role('admin');
  if not in_test_mode() then raise exception 'The audit log of a live system is permanent and cannot be cleared.'; end if;
  if p_confirm is distinct from 'CLEAR' then raise exception 'Type CLEAR to confirm.'; end if;

  -- Same switch the test reset uses to get past the append-only guard, only inside this transaction.
  perform set_config('app.test_reset', 'on', true);
  delete from audit_log where true;
  get diagnostics removed = row_count;
  perform set_config('app.test_reset', 'off', true);

  insert into audit_log (actor, action, details) values (actor, 'audit.cleared', jsonb_build_object('entries_removed', removed));
  return jsonb_build_object('ok', true, 'removed', removed);
end $$;

revoke all on function clear_audit_log(text) from public, anon, authenticated;
grant execute on function clear_audit_log(text) to service_role, authenticated;
