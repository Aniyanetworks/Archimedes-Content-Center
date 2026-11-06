-- Editable example content for the template previews (Templates page and edition preview).
-- Null means "use the built-in example". It is never sent to subscribers.

insert into system_settings (key, value) values
  ('template_sample_hsg', 'null'::jsonb),
  ('template_sample_hospitality', 'null'::jsonb)
on conflict (key) do nothing;

create function set_template_sample(p_division division_t, p_value jsonb) returns void language plpgsql security definer set search_path = public as $$
declare k text := 'template_sample_' || p_division::text;
begin
  perform require_role('admin', 'editor');
  if p_value is not null and jsonb_typeof(p_value) <> 'object' then raise exception 'Example content must be an object'; end if;
  if p_value is not null and coalesce(p_value #>> '{hero,headline}', '') = '' then raise exception 'The main story needs a headline'; end if;
  if octet_length(coalesce(p_value, 'null'::jsonb)::text) > 100000 then raise exception 'Example content is too long'; end if;
  update system_settings set value = coalesce(p_value, 'null'::jsonb), updated_at = now() where key = k;
  perform write_audit(case when p_value is null then 'templates.example_reset' else 'templates.example_changed' end, null, null, null,
    jsonb_build_object('division', p_division));
end $$;

revoke all on function set_template_sample(division_t, jsonb) from public, anon, authenticated;
grant execute on function set_template_sample(division_t, jsonb) to service_role, authenticated;
