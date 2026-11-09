-- Custom templates: admins copy a design and edit its HTML in the app. Each save publishes a new immutable
-- version (sent emails can always be rebuilt), and the admin chooses which plans may use the template.
-- The five built-in designs stay read-only. A custom template can be removed (hidden) but never deleted,
-- because its versions are kept for the newsletters already made with it.

alter table master_templates
  add column is_custom boolean not null default false,
  add column archived boolean not null default false,
  add column created_at timestamptz not null default now();

create function save_custom_template(p_key text, p_name text, p_html text, p_labels jsonb, p_plans text[]) returns text
language plpgsql security definer set search_path = public as $$
declare k text := nullif(trim(coalesce(p_key, '')), ''); m master_templates; next_version int; plan text; missing text[] := '{}';
begin
  perform require_role('admin');
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the template a name.'; end if;
  if length(p_name) > 80 then raise exception 'Keep the name under 80 characters.'; end if;
  if coalesce(p_html, '') = '' then raise exception 'The template HTML is empty.'; end if;
  if octet_length(p_html) > 500000 then raise exception 'The template HTML is too large (over 500 KB).'; end if;
  -- Every email must keep the legal footer and the unsubscribe link.
  if position('[[unsubscribe_html]]' in p_html) = 0 then missing := array_append(missing, 'the unsubscribe link [[unsubscribe_html]]'); end if;
  if position('data-slot="legal"' in p_html) = 0 then missing := array_append(missing, 'the legal footer (an element with data-slot="legal")'); end if;
  if position('[[legal_business_name]]' in p_html) = 0 then missing := array_append(missing, 'the business name [[legal_business_name]]'); end if;
  if position('[[postal_address]]' in p_html) = 0 then missing := array_append(missing, 'the postal address [[postal_address]]'); end if;
  if cardinality(missing) > 0 then raise exception 'The template must include %.', array_to_string(missing, ', '); end if;
  if p_labels is null or jsonb_typeof(p_labels) <> 'object' then raise exception 'Labels are missing.'; end if;
  if exists (select 1 from unnest(coalesce(p_plans, '{}')) x where x not in (select plan_key from plan_entitlements)) then
    raise exception 'Unknown plan.';
  end if;

  if k is null then
    -- A new template: a readable key from the name, made unique.
    k := 'custom_' || left(trim(both '_' from regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g')), 40);
    if k = 'custom_' then k := 'custom_template'; end if;
    while exists (select 1 from master_templates where key = k) loop
      k := regexp_replace(k, '_[0-9]+$', '') || '_' || (floor(random() * 9000) + 1000)::int;
    end loop;
    insert into master_templates (key, name, position, is_custom)
    values (k, trim(p_name), coalesce((select max(position) from master_templates), 0) + 1, true);
    next_version := 1;
  else
    select * into m from master_templates where key = k for update;
    if not found then raise exception 'That template no longer exists.'; end if;
    if not m.is_custom then raise exception 'The built-in designs cannot be edited. Copy one to make your own.'; end if;
    if m.archived then raise exception 'This template was removed.'; end if;
    update master_templates set name = trim(p_name) where key = k;
    select coalesce(max(version), 0) + 1 into next_version from template_versions where template_key = k;
  end if;

  update template_versions set is_current = false where template_key = k and is_current;
  insert into template_versions (template_key, version, mjml_source, compiled_html, labels, is_current)
  values (k, next_version, '<!-- edited as HTML in the app -->', p_html, p_labels, true);

  delete from plan_templates where template_key = k;
  foreach plan in array coalesce(p_plans, '{}') loop
    insert into plan_templates (plan_key, template_key) values (plan, k);
  end loop;

  perform write_audit(case when next_version = 1 then 'templates.created' else 'templates.updated' end, null, null, null,
    jsonb_build_object('key', k, 'name', trim(p_name), 'version', next_version, 'plans', to_jsonb(coalesce(p_plans, '{}'))));
  return k;
end $$;

create function remove_custom_template(p_key text) returns void language plpgsql security definer set search_path = public as $$
declare m master_templates; users int;
begin
  perform require_role('admin');
  select * into m from master_templates where key = p_key for update;
  if not found then raise exception 'That template no longer exists.'; end if;
  if not m.is_custom then raise exception 'The built-in designs cannot be removed.'; end if;
  select count(*) into users from newsletter_preferences where template_key = p_key;
  if users > 0 then
    raise exception '% sub-account(s) use this template. Choose another design for them first.', users;
  end if;
  update master_templates set archived = true where key = p_key;
  delete from plan_templates where template_key = p_key;
  perform write_audit('templates.removed', null, null, null, jsonb_build_object('key', p_key, 'name', m.name));
end $$;

revoke all on function save_custom_template(text, text, text, jsonb, text[]), remove_custom_template(text) from public, anon, authenticated;
grant execute on function save_custom_template(text, text, text, jsonb, text[]), remove_custom_template(text) to service_role, authenticated;
