-- Staff management for admins: see who has access, change roles, remove access.
-- New people are invited by the staff-invite Edge Function, which creates the login and then
-- calls set_staff_role as the inviting admin, so the audit log names who did it.

create function list_staff() returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform require_role('admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id,
      'email', u.email,
      'role', s.role,
      'added_at', s.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'invite_pending', u.last_sign_in_at is null,
      'is_me', s.user_id = auth.uid()
    ) order by lower(u.email))
    from staff_roles s join auth.users u on u.id = s.user_id
  ), '[]'::jsonb);
end $$;

create function set_staff_role(p_user uuid, p_role staff_role_t) returns void language plpgsql security definer set search_path = public, auth as $$
declare old staff_role_t; who text;
begin
  perform require_role('admin');
  select email into who from auth.users where id = p_user;
  if not found then raise exception 'That user does not exist'; end if;
  select role into old from staff_roles where user_id = p_user for update;
  if old = p_role then return; end if;
  if old = 'admin' and (select count(*) from staff_roles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin';
  end if;
  insert into staff_roles (user_id, role) values (p_user, p_role)
  on conflict (user_id) do update set role = excluded.role;
  perform write_audit(case when old is null then 'staff.added' else 'staff.role_changed' end, null, null, null,
    jsonb_build_object('email', who, 'from', old, 'to', p_role));
end $$;

create function remove_staff(p_user uuid) returns void language plpgsql security definer set search_path = public, auth as $$
declare old staff_role_t; who text;
begin
  perform require_role('admin');
  if p_user = auth.uid() then raise exception 'You cannot remove your own access'; end if;
  select role into old from staff_roles where user_id = p_user for update;
  if not found then raise exception 'That person is not on the staff list'; end if;
  if old = 'admin' and (select count(*) from staff_roles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin';
  end if;
  select email into who from auth.users where id = p_user;
  -- Only the staff role goes. The login stays, so the person can be added back later.
  delete from staff_roles where user_id = p_user;
  perform write_audit('staff.removed', null, null, null, jsonb_build_object('email', who, 'role', old));
end $$;

-- Used by the Edge Function when the invited email already has a login.
create function staff_user_id_by_email(p_email text) returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;

do $$
declare f text;
begin
  foreach f in array array['list_staff()', 'set_staff_role(uuid, staff_role_t)', 'remove_staff(uuid)', 'staff_user_id_by_email(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

grant execute on function list_staff(), set_staff_role(uuid, staff_role_t), remove_staff(uuid) to authenticated;
