-- The rules of the engine. "The database enforces access and approvals; the React app only displays
-- and requests." n8n and React both call these functions and neither can bypass the triggers.

alter table campaign_instances
  add column dispatch_hash text,    -- hash of the HTML sent to GHL by the current dispatch attempt
  add column ghl_draft_hash text;   -- hash of the HTML the existing GHL draft actually contains
alter table editions add column queued_version int not null default 0;

create table ops_alerts (
  id bigint generated always as identity primary key,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  kind text not null,
  message text not null,
  dedupe_key text,
  campaign_id uuid,
  tenant_id uuid,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create unique index ops_alerts_open_dedupe on ops_alerts (dedupe_key) where claimed_at is null and dedupe_key is not null;

-- ---------------------------------------------------------------- helpers

create function current_actor() returns text language sql stable security definer set search_path = public, auth as $$
  select coalesce(nullif(current_setting('app.actor', true), ''), (select email::text from auth.users where id = auth.uid()), 'system')
$$;

create function staff_role() returns text language sql stable security definer set search_path = public as $$
  select role::text from staff_roles where user_id = auth.uid()
$$;

create function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_roles where user_id = auth.uid())
$$;

create function my_tenants() returns setof uuid language sql stable security definer set search_path = public as $$
  select tenant_id from tenant_users where user_id = auth.uid()
$$;

create function require_role(variadic p_roles text[]) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(staff_role(), '') <> all (p_roles) then
    raise exception 'Your role does not allow this action' using errcode = '42501';
  end if;
end $$;

create function setting(p_key text) returns jsonb language sql stable security definer set search_path = public as $$
  select value from system_settings where key = p_key
$$;

create function write_audit(p_action text, p_tenant uuid, p_campaign uuid, p_edition uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor, action, tenant_id, campaign_id, edition_id, details)
  values (current_actor(), p_action, p_tenant, p_campaign, p_edition, coalesce(p_details, '{}'))
$$;

create function raise_alert(p_kind text, p_message text, p_severity text default 'warning', p_campaign uuid default null, p_tenant uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into ops_alerts (kind, message, severity, campaign_id, tenant_id, dedupe_key)
  values (p_kind, p_message, p_severity, p_campaign, p_tenant, p_kind || ':' || coalesce(p_campaign::text, p_tenant::text, p_message))
  on conflict (dedupe_key) where claimed_at is null and dedupe_key is not null do nothing
$$;

create function jsonb_text_array(p jsonb) returns text[] language sql immutable as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)), '{}')
$$;

-- ---------------------------------------------------------------- immutability guards

create function guard_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger audit_log_append_only before update or delete on audit_log for each row execute function guard_append_only();
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function guard_append_only();
create trigger approval_events_append_only before update or delete on approval_events for each row execute function guard_append_only();
create trigger approval_events_no_truncate before truncate on approval_events for each statement execute function guard_append_only();

create function guard_template_version() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Template versions are kept for reproducible sends'; end if;
  if (new.template_key, new.version, new.mjml_source, new.compiled_html, new.labels) is distinct from (old.template_key, old.version, old.mjml_source, old.compiled_html, old.labels) then
    raise exception 'Template versions are immutable. Publish a new version instead.';
  end if;
  return new;
end $$;
create trigger template_versions_immutable before update or delete on template_versions for each row execute function guard_template_version();

create function guard_content_item() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (new.headline, new.teaser, new.body, new.image_url, new.image_alt, new.image_license, new.regions, new.division, new.industry, new.cta_label, new.cta_class, new.expires_at, new.season)
    is distinct from (old.headline, old.teaser, old.body, old.image_url, old.image_alt, old.image_license, old.regions, old.division, old.industry, old.cta_label, old.cta_class, old.expires_at, old.season) then
    raise exception 'Only drafts can be edited. Create a new version instead.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger content_items_guard before update on content_items for each row execute function guard_content_item();

-- A brewery edition can never carry roofing content.
create function guard_edition_item() returns trigger language plpgsql as $$
declare e editions; c content_items;
begin
  select * into e from editions where id = new.edition_id;
  select * into c from content_items where id = new.content_item_id;
  if c.division <> e.division or c.industry <> e.industry then
    raise exception 'A % story cannot go into a % edition', c.industry, e.industry;
  end if;
  if c.status <> 'approved' then
    raise exception 'Only approved stories can go into an edition';
  end if;
  return new;
end $$;
create trigger edition_items_guard before insert or update on edition_items for each row execute function guard_edition_item();

-- ---------------------------------------------------------------- send gates

create function has_valid_approval(p_campaign uuid, p_hash text) returns boolean language sql stable security definer set search_path = public as $$
  -- The latest event decides, so a revocation or a later rejection cancels an earlier approval.
  select coalesce((select decision = 'approved' and version_hash = p_hash from approval_events where campaign_id = p_campaign order by id desc limit 1), false)
$$;

create function campaign_audience(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tenants; p newsletter_preferences; pl plan_entitlements;
begin
  select * into t from tenants where id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  select * into pl from plan_entitlements where plan_key = t.plan_key;
  -- Anything short of a fully live tenant reaches test contacts only.
  if setting('safe_test_mode') = 'true'::jsonb or t.test_mode or not t.live_send_enabled or pl.signoff_pending then
    return jsonb_build_object('type', 'contact', 'contactIds', to_jsonb(coalesce(p.test_contact_ids, '{}')));
  end if;
  return jsonb_build_object('type', 'tag', 'tagIds', to_jsonb(coalesce(p.allowed_segments, '{}')));
end $$;

-- Every reason this campaign must not go out right now. Entries starting "paused:" are temporary.
create function send_blockers(p_id uuid) returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  c campaign_instances; t tenants; b brand_profiles; p newsletter_preferences; e editions; audience jsonb; template_key_pinned text;
  r text[] := '{}';
begin
  select * into c from campaign_instances where id = p_id;
  select * into t from tenants where id = c.tenant_id;
  select * into b from brand_profiles where tenant_id = c.tenant_id;
  select * into p from newsletter_preferences where tenant_id = c.tenant_id;
  select * into e from editions where id = c.edition_id;

  if e.status <> 'approved' or e.central_approved_at is null then r := array_append(r, 'central_approval_missing'); end if;
  if e.version <> c.edition_version then r := array_append(r, 'edition_version_changed'); end if;
  if e.expires_at is not null and e.expires_at <= now() then r := array_append(r, 'edition_expired'); end if;
  if c.rendered_html_hash is null then r := array_append(r, 'not_rendered'); end if;
  if t.status <> 'active' then r := array_append(r, 'paused:tenant_inactive'); end if;
  if t.entitlement_status <> 'active' then r := array_append(r, 'entitlement_inactive'); end if;
  if not t.opted_in then r := array_append(r, 'not_opted_in'); end if;
  if not coalesce(b.sender_verified, false) or coalesce(b.from_email, '') = '' then r := array_append(r, 'sender_not_verified'); end if;
  if coalesce(b.postal_address, '') = '' then r := array_append(r, 'missing_postal_address'); end if;
  if coalesce(b.legal_business_name, '') = '' then r := array_append(r, 'missing_legal_name'); end if;
  if coalesce(p.ghl_user_id, '') = '' then r := array_append(r, 'missing_ghl_user'); end if;
  if c.rendered_html is not null and position('data-slot="unsubscribe"' in c.rendered_html) = 0 then r := array_append(r, 'missing_unsubscribe'); end if;
  if c.rendered_html is not null and position('data-slot="legal"' in c.rendered_html) = 0 then r := array_append(r, 'missing_legal_footer'); end if;

  select tv.template_key into template_key_pinned from template_versions tv where tv.id = c.template_version_id;
  if template_key_pinned is not null and not exists (select 1 from plan_templates pt where pt.plan_key = t.plan_key and pt.template_key = template_key_pinned) then
    r := array_append(r, 'template_not_entitled');
  end if;

  if p.review_mode = 'review' and not has_valid_approval(p_id, c.rendered_html_hash) then r := array_append(r, 'client_approval_missing'); end if;

  audience := campaign_audience(c.tenant_id);
  if audience->>'type' = 'contact' and jsonb_array_length(audience->'contactIds') = 0 then r := array_append(r, 'no_test_contacts'); end if;
  if audience->>'type' = 'tag' and jsonb_array_length(audience->'tagIds') = 0 then r := array_append(r, 'no_segment'); end if;

  if e.embargo_at is not null and e.embargo_at > now() then r := array_append(r, 'paused:embargo'); end if;
  if exists (
    select 1 from pause_switches s where s.active and (
      s.scope = 'global'
      or (s.scope = 'division' and s.scope_value = t.division::text)
      or (s.scope = 'industry' and s.scope_value = t.industry)
      or (s.scope = 'tenant' and s.scope_value = t.id::text)
      or (s.scope = 'edition' and s.scope_value = e.id::text)
    )
  ) then r := array_append(r, 'paused:switch'); end if;
  return r;
end $$;

-- Legal moves and hard gates live in a trigger, so no caller, including the service role, can skip them.
create function guard_campaign_status() returns trigger language plpgsql security definer set search_path = public as $$
declare e editions; p newsletter_preferences;
begin
  new.updated_at := now();
  if new.status = old.status then return new; end if;
  if not exists (select 1 from campaign_transitions where from_status = old.status and to_status = new.status) then
    raise exception 'Illegal campaign transition % -> %', old.status, new.status;
  end if;
  select * into e from editions where id = new.edition_id;
  select * into p from newsletter_preferences where tenant_id = new.tenant_id;
  if new.status in ('CENTRAL_APPROVED', 'AUTO_QUEUED', 'CLIENT_REVIEW_PENDING', 'APPROVED_FOR_SEND', 'SCHEDULED', 'SENDING') then
    if e.status <> 'approved' or e.version <> new.edition_version then
      raise exception 'Central approval of the current edition version is required for %', new.status;
    end if;
    if new.rendered_html_hash is null then raise exception 'A rendered version is required for %', new.status; end if;
  end if;
  if new.status in ('APPROVED_FOR_SEND', 'SCHEDULED') and p.review_mode = 'review' and not has_valid_approval(new.id, new.rendered_html_hash) then
    raise exception 'Client approval of the current rendered version is required for %', new.status;
  end if;
  insert into audit_log (actor, action, tenant_id, campaign_id, edition_id, details)
  values (current_actor(), 'campaign.status', new.tenant_id, new.id, new.edition_id,
    jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.status_reason, 'hash', new.rendered_html_hash));
  return new;
end $$;
create trigger campaign_status_guard before update on campaign_instances for each row execute function guard_campaign_status();

create function guard_campaign_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('READY_TO_RENDER', 'NOT_ELIGIBLE') then
    raise exception 'New campaigns must start at READY_TO_RENDER or NOT_ELIGIBLE';
  end if;
  insert into audit_log (actor, action, tenant_id, campaign_id, edition_id, details)
  values (current_actor(), 'campaign.created', new.tenant_id, new.id, new.edition_id, jsonb_build_object('status', new.status, 'reason', new.status_reason));
  return new;
end $$;
create trigger campaign_insert_guard before insert on campaign_instances for each row execute function guard_campaign_insert();

create function set_status(p_id uuid, p_to campaign_status_t, p_reason text) returns void language sql security definer set search_path = public as $$
  update campaign_instances set status = p_to, status_reason = p_reason where id = p_id
$$;

create function request_ghl_cancel(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update campaign_instances set
    cancel_requested_at = case when ghl_campaign_id like 'dry-run-%' then null else now() end,
    ghl_campaign_id = case when ghl_campaign_id like 'dry-run-%' then null else ghl_campaign_id end
  where id = p_id and ghl_campaign_id is not null;
end $$;

create function revoke_review_tokens(p_campaign uuid) returns void language sql security definer set search_path = public as $$
  update review_tokens set revoked_at = now() where campaign_id = p_campaign and revoked_at is null and consumed_at is null
$$;

create function compute_send_at(p_week date, p_tenant uuid) returns timestamptz language sql stable security definer set search_path = public as $$
  select (((p_week + (p.preferred_weekday - 1)) + p.preferred_local_time) at time zone t.timezone) + make_interval(mins => t.stagger_minutes)
  from tenants t join newsletter_preferences p on p.tenant_id = t.id where t.id = p_tenant
$$;

-- Throws away a render. Any approval of it stops applying, and a GHL draft holding the old HTML is deleted.
create function reset_for_render(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances; e editions;
begin
  select * into c from campaign_instances where id = p_id for update;
  select * into e from editions where id = c.edition_id;
  if has_valid_approval(p_id, c.rendered_html_hash) then
    insert into approval_events (campaign_id, tenant_id, edition_id, decision, version_hash, reviewer_identity, notes)
    values (p_id, c.tenant_id, c.edition_id, 'revoked', c.rendered_html_hash, current_actor(), p_reason);
    perform write_audit('approval.invalidated', c.tenant_id, p_id, c.edition_id, jsonb_build_object('reason', p_reason));
  end if;
  perform revoke_review_tokens(p_id);
  perform request_ghl_cancel(p_id);
  update campaign_instances set
    status = 'READY_TO_RENDER', status_reason = p_reason, edition_version = e.version, template_version_id = null, rendered_html = null, rendered_text = null,
    rendered_subject = null, rendered_html_hash = null, rendered_at = null, render_claimed_at = null, review_deadline = null, review_invite_requested_at = null,
    review_invite_sent_at = null, dispatch_state = 'none', dispatch_attempts = 0, dispatch_hash = null, ghl_draft_hash = null, next_attempt_at = null, last_error = null,
    dead_lettered_at = null, scheduled_at = greatest(compute_send_at(e.publication_week, c.tenant_id), now() + interval '30 minutes')
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- publishing: queue and render

create function tenant_ineligible_reason(p_tenant uuid, p_edition uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare t tenants; p newsletter_preferences; e editions; b brand_profiles;
begin
  select * into t from tenants where id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  select * into b from brand_profiles where tenant_id = p_tenant;
  select * into e from editions where id = p_edition;
  if t.entitlement_status <> 'active' then return 'entitlement_inactive'; end if;
  if not t.opted_in then return 'not_opted_in'; end if;
  if cardinality(e.eligible_plans) > 0 and not t.plan_key = any (e.eligible_plans) then return 'plan_not_eligible'; end if;
  if p.template_key is null then return 'no_template_selected'; end if;
  if not exists (select 1 from plan_templates pt where pt.plan_key = t.plan_key and pt.template_key = p.template_key) then return 'template_not_entitled'; end if;
  if coalesce(b.newsletter_name, '') = '' then return 'missing_brand_profile'; end if;
  return null;
end $$;

-- Weekly tenants get every edition. Biweekly tenants get alternating editions, decided by a stable
-- per-tenant offset: consecutive weeks always alternate, which gives 26 editions in any 52 weeks.
create function tenant_receives_week(p_tenant uuid, p_week date) returns boolean language plpgsql stable security definer set search_path = public as $$
declare t tenants; p newsletter_preferences; pl plan_entitlements; effective cadence_t;
begin
  select * into t from tenants where id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  select * into pl from plan_entitlements where plan_key = t.plan_key;
  effective := case when p.cadence = any (pl.allowed_cadences) then p.cadence else pl.default_cadence end;
  if effective = 'weekly' then return true; end if;
  return ((p_week - date '2024-01-01') / 7 + t.biweekly_offset) % 2 = 0;
end $$;

create function list_editions_to_queue() returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('edition_id', id) from editions
  where status = 'approved'
    and (expires_at is null or expires_at > now())
    and (queued_version < version or publication_week >= (date_trunc('week', now() at time zone 'UTC'))::date)
$$;

create function queue_edition_campaigns(p_edition uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare e editions; t tenants; c campaign_instances; reason text; send_at timestamptz; key text; created int := 0; reset int := 0;
begin
  select * into e from editions where id = p_edition for update;
  if e.status <> 'approved' then raise exception 'Edition % is not centrally approved', p_edition; end if;
  for t in select * from tenants where division = e.division and industry = e.industry loop
    if not tenant_receives_week(t.id, e.publication_week) then continue; end if;
    reason := tenant_ineligible_reason(t.id, p_edition);
    send_at := compute_send_at(e.publication_week, t.id);
    key := t.id || ':' || e.id || ':default';
    select * into c from campaign_instances where idempotency_key = key for update;
    if not found then
      if reason is null and send_at < now() then reason := 'send_window_passed'; end if;
      insert into campaign_instances (tenant_id, edition_id, edition_version, idempotency_key, status, status_reason, scheduled_at)
      values (t.id, e.id, e.version, key, case when reason is null then 'READY_TO_RENDER' else 'NOT_ELIGIBLE' end::campaign_status_t, reason, send_at);
      created := created + 1;
    elsif c.edition_version < e.version and c.status not in ('SENT', 'SENDING', 'CANCELED') then
      if reason is null then
        perform reset_for_render(c.id, 'edition_reapproved');
        reset := reset + 1;
      end if;
    elsif c.status = 'NOT_ELIGIBLE' and reason is null and send_at >= now() then
      perform reset_for_render(c.id, 'now_eligible');
      reset := reset + 1;
    end if;
  end loop;
  update editions set queued_version = version where id = p_edition;
  return jsonb_build_object('created', created, 'reset', reset);
end $$;

create function claim_campaigns_for_render(p_limit int default 50) returns setof jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances; t tenants; p newsletter_preferences; e editions; b brand_profiles; tv template_versions; hero jsonb; secondary jsonb; offer jsonb;
begin
  for c in
    select ci.* from campaign_instances ci join editions ed on ed.id = ci.edition_id
    where ci.status = 'READY_TO_RENDER' and ed.status = 'approved' and ed.version = ci.edition_version
      and (ci.render_claimed_at is null or ci.render_claimed_at < now() - interval '15 minutes')
    order by ci.scheduled_at limit p_limit for update of ci skip locked
  loop
    select * into t from tenants where id = c.tenant_id;
    select * into p from newsletter_preferences where tenant_id = c.tenant_id;
    select * into b from brand_profiles where tenant_id = c.tenant_id;
    select * into e from editions where id = c.edition_id;
    select * into tv from template_versions where template_key = p.template_key and is_current;
    if tv.id is null then
      perform set_status(c.id, 'HELD', 'no_current_template');
      continue;
    end if;
    update campaign_instances set template_version_id = tv.id, render_claimed_at = now() where id = c.id;

    -- Region-specific and expired stories are removed here, per tenant.
    select to_jsonb(ci) into hero from edition_items ei join content_items ci on ci.id = ei.content_item_id
    where ei.edition_id = e.id and ei.slot = 'hero'
      and (cardinality(ci.regions) = 0 or ci.regions && t.service_areas) and (ci.expires_at is null or ci.expires_at > c.scheduled_at)
    limit 1;
    select coalesce(jsonb_agg(to_jsonb(ci) order by ei.position), '[]') into secondary from edition_items ei join content_items ci on ci.id = ei.content_item_id
    where ei.edition_id = e.id and ei.slot = 'secondary'
      and (cardinality(ci.regions) = 0 or ci.regions && t.service_areas) and (ci.expires_at is null or ci.expires_at > c.scheduled_at);

    offer := case when b.offer_approved and coalesce(b.offer_headline, '') <> '' and (b.offer_expires_at is null or b.offer_expires_at > c.scheduled_at)
      then jsonb_build_object('headline', b.offer_headline, 'body', b.offer_body, 'cta_label', b.offer_cta_label, 'url', b.offer_url) end;

    return next jsonb_build_object(
      'campaign_id', c.id, 'template_html', tv.compiled_html, 'labels', tv.labels, 'division', t.division,
      'edition', jsonb_build_object('subject', e.subject, 'preview_text', e.preview_text),
      'tenant', jsonb_build_object('division', t.division),
      'brand', to_jsonb(b), 'hero', hero, 'secondary', secondary, 'offer', offer
    );
  end loop;
end $$;

create function route_campaign(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances; p newsletter_preferences; hard text[]; deadline timestamptz;
begin
  select * into c from campaign_instances where id = p_id;
  select * into p from newsletter_preferences where tenant_id = c.tenant_id;
  select coalesce(array_agg(b), '{}') into hard from unnest(send_blockers(p_id)) b where b not like 'paused:%' and b <> 'client_approval_missing';
  if cardinality(hard) > 0 then
    perform set_status(p_id, 'HELD', array_to_string(hard, ','));
    perform raise_alert('campaign_blocked', 'Held: ' || array_to_string(hard, ', '), 'warning', p_id, c.tenant_id);
    return;
  end if;
  perform set_status(p_id, 'CENTRAL_APPROVED', null);
  if p.review_mode = 'review' then
    if coalesce(p.reviewer_email, '') = '' then
      perform set_status(p_id, 'HELD', 'no_reviewer_configured');
      perform raise_alert('campaign_blocked', 'Review mode has no reviewer email', 'warning', p_id, c.tenant_id);
      return;
    end if;
    deadline := c.scheduled_at - make_interval(hours => p.approval_deadline_hours);
    if deadline <= now() then
      -- No time left to review, which means hold. Never an implied approval.
      perform set_status(p_id, 'HELD', 'review_deadline_missed');
      return;
    end if;
    update campaign_instances set review_deadline = deadline, review_invite_requested_at = greatest(now(), deadline - interval '24 hours'), review_invite_sent_at = null where id = p_id;
    perform set_status(p_id, 'CLIENT_REVIEW_PENDING', null);
  else
    perform set_status(p_id, 'AUTO_QUEUED', null);
    perform set_status(p_id, 'APPROVED_FOR_SEND', 'automatic');
  end if;
end $$;

-- The hash is computed here, never accepted from a caller.
create function record_render(p_id uuid, p_html text, p_text text, p_subject text) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  select * into c from campaign_instances where id = p_id for update;
  if c.status <> 'READY_TO_RENDER' then return jsonb_build_object('ok', false, 'reason', 'not_ready'); end if;
  if coalesce(p_html, '') = '' then raise exception 'Empty render for %', p_id; end if;
  update campaign_instances set rendered_html = p_html, rendered_text = p_text, rendered_subject = p_subject,
    rendered_html_hash = encode(sha256(convert_to(p_html, 'UTF8')), 'hex'), rendered_at = now(), status = 'RENDERED', status_reason = null
  where id = p_id;
  perform route_campaign(p_id);
  return jsonb_build_object('ok', true);
end $$;

create function record_render_failure(p_id uuid, p_errors jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  select * into c from campaign_instances where id = p_id for update;
  if c.status <> 'READY_TO_RENDER' then return jsonb_build_object('ok', false); end if;
  perform set_status(p_id, 'HELD', 'render_failed: ' || array_to_string(jsonb_text_array(p_errors), ','));
  perform raise_alert('render_failed', 'Render failed: ' || array_to_string(jsonb_text_array(p_errors), ', '), 'warning', p_id, c.tenant_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- client review

-- While a tenant is in test mode, its review mail goes to internal addresses only.
create function review_recipient(p_tenant uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare t tenants; p newsletter_preferences;
begin
  select * into t from tenants where id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  if setting('safe_test_mode') = 'true'::jsonb or t.test_mode or not t.live_send_enabled then
    return setting('internal_preview_addresses')->>0;
  end if;
  return p.reviewer_email;
end $$;

create function list_review_invites_due(p_limit int default 50) returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'campaign_id', c.id, 'reviewer_name', p.reviewer_name, 'newsletter_name', b.newsletter_name,
    'deadline_display', to_char(c.review_deadline at time zone t.timezone, 'Dy, Mon DD at HH12:MI AM') || ' (' || t.timezone || ')'
  )
  from campaign_instances c join tenants t on t.id = c.tenant_id
  join newsletter_preferences p on p.tenant_id = c.tenant_id join brand_profiles b on b.tenant_id = c.tenant_id
  where c.status = 'CLIENT_REVIEW_PENDING' and c.review_invite_sent_at is null and c.review_invite_requested_at <= now() and c.review_deadline > now()
    and review_recipient(c.tenant_id) is not null
  order by c.review_deadline limit p_limit
$$;

create function mark_review_invite_sent(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  update campaign_instances set review_invite_sent_at = now() where id = p_id returning * into c;
  perform write_audit('review.invite_sent', c.tenant_id, p_id, c.edition_id);
  return jsonb_build_object('ok', true);
end $$;

create function issue_review_token(p_campaign uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances; recipient text; jti uuid;
begin
  select * into c from campaign_instances where id = p_campaign for update;
  if c.status <> 'CLIENT_REVIEW_PENDING' or c.review_deadline <= now() then raise exception 'Campaign is not awaiting review'; end if;
  recipient := review_recipient(c.tenant_id);
  if recipient is null then raise exception 'No review recipient configured'; end if;
  perform revoke_review_tokens(p_campaign);
  insert into review_tokens (campaign_id, tenant_id, version_hash, reviewer_email, expires_at)
  values (p_campaign, c.tenant_id, c.rendered_html_hash, recipient, c.review_deadline) returning review_tokens.jti into jti;
  return jsonb_build_object('jti', jti, 'cid', p_campaign, 'tid', c.tenant_id, 'hash', c.rendered_html_hash, 'exp', extract(epoch from c.review_deadline)::bigint, 'to', recipient);
end $$;

-- Checks the database copy of a token whose signature the Edge Function has already verified.
create function review_token_row(p_jti uuid, p_campaign uuid, p_tenant uuid, p_hash text) returns review_tokens language plpgsql stable security definer set search_path = public as $$
declare k review_tokens;
begin
  select * into k from review_tokens where jti = p_jti;
  if not found or k.campaign_id <> p_campaign or k.tenant_id <> p_tenant or k.version_hash <> p_hash then
    raise exception 'This review link is not valid.';
  end if;
  return k;
end $$;

create function review_view(p_jti uuid, p_campaign uuid, p_tenant uuid, p_hash text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k review_tokens; c campaign_instances; t tenants; b brand_profiles; state text; message text; closed boolean;
begin
  k := review_token_row(p_jti, p_campaign, p_tenant, p_hash);
  select * into c from campaign_instances where id = p_campaign;
  select * into t from tenants where id = p_tenant;
  select * into b from brand_profiles where tenant_id = p_tenant;
  closed := false;
  if k.consumed_at is not null then
    state := 'decided'; message := 'A decision has already been recorded for this version.';
  elsif k.revoked_at is not null or c.rendered_html_hash is distinct from k.version_hash then
    state := 'closed'; message := 'This newsletter has changed, so this link no longer applies. You will receive a new link if your review is needed.'; closed := true;
  elsif k.expires_at <= now() or c.status <> 'CLIENT_REVIEW_PENDING' then
    state := 'closed'; message := 'This review is closed and nothing further is needed from this link.'; closed := true;
  else
    state := 'pending';
  end if;
  return jsonb_build_object(
    'state', state, 'message', message, 'campaign_id', c.id, 'tenant_name', t.name, 'newsletter_name', b.newsletter_name, 'subject', c.rendered_subject,
    'timezone', t.timezone, 'deadline', c.review_deadline, 'send_at', c.scheduled_at, 'version_hash', k.version_hash,
    'html', case when closed then '' else coalesce(c.rendered_html, '') end
  );
end $$;

create function review_decide(p_jti uuid, p_campaign uuid, p_tenant uuid, p_hash text, p_action text, p_version_hash text, p_notes text, p_ip text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k review_tokens; c campaign_instances; decision approval_decision_t; nxt campaign_status_t;
begin
  perform set_config('app.actor', 'reviewer', true);
  k := review_token_row(p_jti, p_campaign, p_tenant, p_hash);
  select * into c from campaign_instances where id = p_campaign for update;
  select * into k from review_tokens where jti = p_jti for update;
  if k.consumed_at is not null then raise exception 'A decision has already been recorded for this version.'; end if;
  if k.revoked_at is not null or k.expires_at <= now() then raise exception 'This review link has expired.'; end if;
  if c.status <> 'CLIENT_REVIEW_PENDING' then raise exception 'This review is closed.'; end if;
  -- The approval applies to the current rendered version only: page, token and campaign must all agree.
  if c.rendered_html_hash is distinct from k.version_hash or p_version_hash is distinct from k.version_hash then
    raise exception 'This newsletter has changed since you opened it. Reload to review the current version.';
  end if;
  if p_action = 'approve' then decision := 'approved'; nxt := 'APPROVED_FOR_SEND';
  elsif p_action = 'request_changes' then
    if coalesce(trim(p_notes), '') = '' then raise exception 'Please describe the changes you need.'; end if;
    decision := 'revision_requested'; nxt := 'REVISION_REQUESTED';
  elsif p_action = 'skip' then decision := 'skipped'; nxt := 'CANCELED';
  else raise exception 'Unknown action';
  end if;
  insert into approval_events (campaign_id, tenant_id, edition_id, decision, version_hash, reviewer_identity, requested_at, notes, ip, user_agent)
  values (c.id, c.tenant_id, c.edition_id, decision, k.version_hash, k.reviewer_email, k.created_at, p_notes, p_ip, p_user_agent);
  update review_tokens set consumed_at = now() where jti = p_jti;
  perform set_status(c.id, nxt, 'reviewer_' || p_action);
  if nxt = 'CANCELED' then perform request_ghl_cancel(c.id); end if;
  if nxt = 'REVISION_REQUESTED' then
    perform raise_alert('revision_requested', 'Reviewer requested changes: ' || left(p_notes, 300), 'info', c.id, c.tenant_id);
  end if;
  return review_view(p_jti, p_campaign, p_tenant, p_hash) || jsonb_build_object('state', 'decided', 'message', 'Your decision has been recorded. Thank you.', 'decision', p_action);
end $$;

create function hold_expired_reviews() returns setof jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances; b brand_profiles; recipient text;
begin
  for c in select * from campaign_instances where status = 'CLIENT_REVIEW_PENDING' and review_deadline <= now() for update skip locked loop
    perform set_status(c.id, 'HELD', 'review_deadline_missed');
    perform revoke_review_tokens(c.id);
    perform raise_alert('review_deadline_missed', 'Review deadline missed. Campaign held.', 'info', c.id, c.tenant_id);
    select * into b from brand_profiles where tenant_id = c.tenant_id;
    recipient := review_recipient(c.tenant_id);
    if recipient is not null then
      return next jsonb_build_object('notify_email', recipient, 'newsletter_name', b.newsletter_name, 'campaign_id', c.id);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- dispatch to GHL

create function claim_campaigns_for_dispatch(p_limit int default 100, p_window_minutes int default 60) returns setof jsonb language plpgsql security definer set search_path = public as $$
declare
  c campaign_instances; t tenants; p newsletter_preferences; b brand_profiles; e editions; blockers text[]; hard text[];
  dry boolean := coalesce(setting('ghl_dry_run') = 'true'::jsonb, true); cap jsonb := setting('daily_send_cap'); used int; send_at timestamptz; hash text;
begin
  if not dry then
    if cap is null or cap = 'null'::jsonb then
      perform raise_alert('daily_cap_not_set', 'Dispatch is blocked because no daily send cap is configured.', 'critical');
      return;
    end if;
    select count(*) into used from campaign_instances where dispatch_started_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' and ghl_campaign_id is distinct from 'dry-run';
  end if;
  for c in
    select * from campaign_instances
    where status = 'APPROVED_FOR_SEND' and dispatch_state in ('none', 'retry_safe') and cancel_requested_at is null
      and scheduled_at <= now() + make_interval(mins => p_window_minutes) and (next_attempt_at is null or next_attempt_at <= now())
    order by scheduled_at limit p_limit for update skip locked
  loop
    if c.scheduled_at < now() - interval '24 hours' then
      perform set_status(c.id, 'HELD', 'send_window_passed');
      continue;
    end if;
    blockers := send_blockers(c.id);
    select coalesce(array_agg(x), '{}') into hard from unnest(blockers) x where x not like 'paused:%';
    if cardinality(hard) > 0 then
      perform set_status(c.id, 'HELD', array_to_string(hard, ','));
      perform raise_alert('campaign_blocked', 'Held at dispatch: ' || array_to_string(hard, ', '), 'warning', c.id, c.tenant_id);
      continue;
    end if;
    if cardinality(blockers) > 0 then continue; end if; -- paused: stays queued
    if not dry then
      if used >= (cap #>> '{}')::int then
        perform raise_alert('daily_cap_reached', 'Daily send cap reached. Remaining campaigns wait for the next UTC day.', 'warning');
        return;
      end if;
      used := used + 1;
    end if;

    select * into t from tenants where id = c.tenant_id;
    select * into p from newsletter_preferences where tenant_id = c.tenant_id;
    select * into b from brand_profiles where tenant_id = c.tenant_id;
    select * into e from editions where id = c.edition_id;
    send_at := greatest(c.scheduled_at, now() + interval '10 minutes');
    hash := c.rendered_html_hash;
    update campaign_instances set dispatch_state = 'in_flight', dispatch_attempts = dispatch_attempts + 1, dispatch_started_at = now(), dispatch_hash = hash, scheduled_at = send_at where id = c.id;
    return next jsonb_build_object(
      'campaign_id', c.id, 'dry_run', dry, 'ghl_location_id', t.ghl_location_id, 'ghl_campaign_id', c.ghl_campaign_id, 'idempotency_key', c.idempotency_key,
      -- The name carries the idempotency key, which lets reconciliation find a draft after an interrupted create.
      'ghl_create_body', jsonb_build_object('name', left(b.newsletter_name, 60) || ' [' || c.idempotency_key || ']', 'editorType', 'html', 'editorContent', c.rendered_html, 'timeZone', t.timezone, 'userId', p.ghl_user_id),
      'ghl_schedule_body', jsonb_build_object(
        'scheduleType', 'scheduled', 'timeZone', t.timezone, 'userId', p.ghl_user_id,
        'emailMeta', jsonb_strip_nulls(jsonb_build_object('subject', c.rendered_subject, 'fromName', coalesce(b.from_name, t.name), 'fromEmail', b.from_email, 'replyToAddress', b.reply_to, 'previewText', nullif(e.preview_text, ''))),
        'recipients', campaign_audience(t.id),
        'scheduleConfig', jsonb_build_object('sendAt', to_char(send_at at time zone t.timezone, 'YYYY-MM-DD HH12:MI AM'), 'tracking', jsonb_build_object('clickTracking', true))
      )
    );
  end loop;
end $$;

create function get_ghl_token(p_location text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare secret_name text; token text;
begin
  select coalesce(ghl_token_secret, 'ghl_' || ghl_location_id) into secret_name from tenants where ghl_location_id = p_location;
  select decrypted_secret into token from vault.decrypted_secrets where name = secret_name;
  -- A missing token must not stop the batch: GHL answers 401 and only this tenant fails.
  return jsonb_build_object('token', token);
end $$;

create function record_dry_run(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  select * into c from campaign_instances where id = p_id for update;
  if c.status <> 'APPROVED_FOR_SEND' then return jsonb_build_object('ok', false); end if;
  update campaign_instances set ghl_campaign_id = 'dry-run-' || p_id, ghl_draft_hash = rendered_html_hash, dispatch_state = 'done', status = 'SCHEDULED', status_reason = 'dry_run' where id = p_id;
  perform write_audit('dispatch.dry_run', c.tenant_id, p_id, c.edition_id, jsonb_build_object('audience', campaign_audience(c.tenant_id)));
  return jsonb_build_object('ok', true);
end $$;

create function record_ghl_draft(p_id uuid, p_ghl_id text) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  update campaign_instances set ghl_campaign_id = p_ghl_id, ghl_draft_hash = dispatch_hash where id = p_id returning * into c;
  perform write_audit('dispatch.draft_created', c.tenant_id, p_id, c.edition_id, jsonb_build_object('ghl_campaign_id', p_ghl_id));
  return jsonb_build_object('ok', true);
end $$;

-- Last gate before anything can send. Runs after the slow steps, so a late pause or revocation still stops it.
create function pre_schedule_check(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances; blockers text[]; hard text[];
begin
  select * into c from campaign_instances where id = p_id for update;
  if c.status <> 'APPROVED_FOR_SEND' or c.cancel_requested_at is not null then
    update campaign_instances set dispatch_state = 'none' where id = p_id;
    return jsonb_build_object('clear', false, 'reason', 'status_changed');
  end if;
  if c.ghl_draft_hash is distinct from c.rendered_html_hash then
    perform reset_for_render(p_id, 'ghl_draft_outdated');
    return jsonb_build_object('clear', false, 'reason', 'ghl_draft_outdated');
  end if;
  blockers := send_blockers(p_id);
  select coalesce(array_agg(x), '{}') into hard from unnest(blockers) x where x not like 'paused:%';
  if cardinality(hard) > 0 then
    update campaign_instances set dispatch_state = 'none' where id = p_id;
    perform set_status(p_id, 'HELD', array_to_string(hard, ','));
    return jsonb_build_object('clear', false, 'reason', array_to_string(hard, ','));
  end if;
  if cardinality(blockers) > 0 then
    update campaign_instances set dispatch_state = 'retry_safe', next_attempt_at = now() + interval '5 minutes' where id = p_id;
    return jsonb_build_object('clear', false, 'reason', 'paused');
  end if;
  return jsonb_build_object('clear', true, 'ghl_campaign_id', c.ghl_campaign_id);
end $$;

create function track_ghl_usage(p_location text, p_is_error boolean, p_burst int, p_daily int) returns void language sql security definer set search_path = public as $$
  insert into ghl_api_usage as u (bucket, ghl_location_id, calls, errors, burst_remaining, daily_remaining)
  values (date_trunc('hour', now()), p_location, 1, case when p_is_error then 1 else 0 end, p_burst, p_daily)
  on conflict (bucket, ghl_location_id) do update set calls = u.calls + 1, errors = u.errors + excluded.errors,
    burst_remaining = coalesce(excluded.burst_remaining, u.burst_remaining), daily_remaining = coalesce(excluded.daily_remaining, u.daily_remaining)
$$;

-- Outcomes: scheduled, retry_safe (GHL did not act), failed (GHL refused), unknown (GHL may have acted).
create function record_dispatch_result(p_id uuid, p_stage text, p_outcome text, p_http_status int default null, p_message text default null, p_burst int default null, p_daily int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances; loc text; msg text;
begin
  select * into c from campaign_instances where id = p_id for update;
  select ghl_location_id into loc from tenants where id = c.tenant_id;
  perform track_ghl_usage(loc, p_outcome <> 'scheduled', p_burst, p_daily);
  msg := p_stage || ': ' || coalesce(p_message, 'HTTP ' || p_http_status, 'no response');
  perform write_audit('dispatch.' || p_outcome, c.tenant_id, p_id, c.edition_id, jsonb_build_object('stage', p_stage, 'http_status', p_http_status, 'message', p_message, 'attempt', c.dispatch_attempts));

  if p_outcome = 'scheduled' then
    if c.status = 'APPROVED_FOR_SEND' then
      update campaign_instances set dispatch_state = 'done', last_error = null, status = 'SCHEDULED', status_reason = null where id = p_id;
    else
      -- Someone canceled or held it while the request was in flight, so take it back out of GHL.
      update campaign_instances set dispatch_state = 'done' where id = p_id;
      perform request_ghl_cancel(p_id);
      perform raise_alert('scheduled_after_stop', 'GHL scheduled a campaign that had already been stopped. Cancellation requested.', 'critical', p_id, c.tenant_id);
    end if;
  elsif p_outcome = 'retry_safe' then
    if c.dispatch_attempts >= 5 then
      update campaign_instances set dispatch_state = 'retry_safe', last_error = msg, dead_lettered_at = now() where id = p_id;
      perform set_status(p_id, 'FAILED', 'retries_exhausted');
      perform raise_alert('dead_letter', 'Retries exhausted: ' || msg, 'critical', p_id, c.tenant_id);
    else
      update campaign_instances set dispatch_state = 'retry_safe', last_error = msg, next_attempt_at = now() + make_interval(mins => power(2, c.dispatch_attempts)::int) where id = p_id;
    end if;
  elsif p_outcome = 'failed' then
    update campaign_instances set dispatch_state = 'retry_safe', last_error = msg, dead_lettered_at = now() where id = p_id;
    perform set_status(p_id, 'FAILED', 'ghl_rejected');
    perform raise_alert('dispatch_failed', msg, 'critical', p_id, c.tenant_id);
  elsif p_outcome = 'unknown' then
    -- Never retried blindly: workflow 07 has to establish what happened first.
    update campaign_instances set dispatch_state = 'unknown', last_error = msg where id = p_id;
    perform raise_alert('dispatch_unknown', 'Outcome unknown, reconciling: ' || msg, 'warning', p_id, c.tenant_id);
  else
    raise exception 'Unknown dispatch outcome %', p_outcome;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function list_campaigns_to_reconcile(p_limit int default 100) returns setof jsonb language plpgsql security definer set search_path = public as $$
begin
  -- A worker that died mid-dispatch leaves its outcome unknown.
  update campaign_instances set dispatch_state = 'unknown', last_error = 'dispatch worker did not report back'
  where dispatch_state = 'in_flight' and dispatch_started_at < now() - interval '15 minutes';

  -- Dry runs never reach GHL, so they complete on the clock.
  update campaign_instances set status = 'SENT', sent_at = scheduled_at, status_reason = 'dry_run'
  where status = 'SCHEDULED' and ghl_campaign_id like 'dry-run-%' and scheduled_at <= now();

  return query
  select jsonb_build_object('campaign_id', c.id, 'ghl_location_id', t.ghl_location_id, 'ghl_campaign_id', c.ghl_campaign_id, 'idempotency_key', c.idempotency_key)
  from campaign_instances c join tenants t on t.id = c.tenant_id
  where (c.dispatch_state = 'unknown' and c.status in ('APPROVED_FOR_SEND', 'SCHEDULED', 'HELD', 'CANCELED', 'FAILED'))
     or (c.status in ('SCHEDULED', 'SENDING') and c.ghl_campaign_id not like 'dry-run-%' and c.scheduled_at <= now())
  order by c.scheduled_at limit p_limit;
end $$;

create function record_reconcile(p_id uuid, p_reachable boolean, p_found boolean, p_ghl_id text default null, p_ghl_status text default null, p_http_status int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances; loc text;
begin
  select * into c from campaign_instances where id = p_id for update;
  select ghl_location_id into loc from tenants where id = c.tenant_id;
  perform track_ghl_usage(loc, not coalesce(p_reachable, false), null, null);
  if not coalesce(p_reachable, false) then
    perform raise_alert('reconcile_unreachable', 'GHL could not be reached to reconcile this campaign (HTTP ' || coalesce(p_http_status::text, 'none') || ').', 'warning', p_id, c.tenant_id);
    return jsonb_build_object('ok', false);
  end if;
  perform write_audit('dispatch.reconciled', c.tenant_id, p_id, c.edition_id, jsonb_build_object('found', p_found, 'ghl_id', p_ghl_id, 'ghl_status', p_ghl_status, 'state', c.dispatch_state));

  if c.dispatch_state = 'unknown' then
    if not coalesce(p_found, false) then
      -- GHL confirms nothing exists, so another attempt cannot duplicate.
      update campaign_instances set dispatch_state = 'retry_safe', next_attempt_at = now(), ghl_campaign_id = null, ghl_draft_hash = null where id = p_id;
      return jsonb_build_object('ok', true, 'resolution', 'not_found_retry_safe');
    end if;
    update campaign_instances set ghl_campaign_id = p_ghl_id, ghl_draft_hash = coalesce(ghl_draft_hash, dispatch_hash) where id = p_id;
    if c.status <> 'APPROVED_FOR_SEND' then
      update campaign_instances set dispatch_state = 'done' where id = p_id;
      if p_ghl_status in ('sent', 'processing') then
        perform raise_alert('sent_after_stop', 'GHL has already sent a campaign marked ' || c.status || '. Check it by hand.', 'critical', p_id, c.tenant_id);
        return jsonb_build_object('ok', true, 'resolution', 'already_sent');
      end if;
      perform request_ghl_cancel(p_id);
      return jsonb_build_object('ok', true, 'resolution', 'stopped_cancel_requested');
    end if;
    if p_ghl_status in ('scheduled', 'processing', 'sent') then
      update campaign_instances set dispatch_state = 'done', last_error = null, status = 'SCHEDULED', status_reason = 'reconciled' where id = p_id;
      c.status := 'SCHEDULED';
    elsif p_ghl_status = 'failed' then
      update campaign_instances set dispatch_state = 'retry_safe', status = 'FAILED', status_reason = 'ghl_reported_failed', last_error = 'GHL reports the campaign failed' where id = p_id;
      perform raise_alert('dispatch_failed', 'GHL reports the campaign failed', 'critical', p_id, c.tenant_id);
      return jsonb_build_object('ok', true, 'resolution', 'failed');
    else
      -- The draft exists but was not scheduled, so the retry reuses it instead of creating another.
      update campaign_instances set dispatch_state = 'retry_safe', next_attempt_at = now() where id = p_id;
      return jsonb_build_object('ok', true, 'resolution', 'draft_found_retry_safe');
    end if;
  end if;

  if c.status in ('SCHEDULED', 'SENDING') then
    if not coalesce(p_found, false) or p_ghl_status in ('cancelled', 'paused', 'archived', 'draft') then
      if c.status = 'SENDING' then
        update campaign_instances set status = 'FAILED', status_reason = 'ghl_state_' || coalesce(p_ghl_status, 'missing'), dispatch_state = 'unknown' where id = p_id;
      else
        update campaign_instances set status = 'HELD', status_reason = 'ghl_state_' || coalesce(p_ghl_status, 'missing') where id = p_id;
      end if;
      perform raise_alert('ghl_state_mismatch', 'GHL no longer has this campaign scheduled (' || coalesce(p_ghl_status, 'missing') || ').', 'critical', p_id, c.tenant_id);
    elsif p_ghl_status = 'sent' then
      update campaign_instances set status = 'SENT', sent_at = now(), status_reason = null where id = p_id;
    elsif p_ghl_status = 'processing' and c.status = 'SCHEDULED' then
      update campaign_instances set status = 'SENDING', status_reason = null where id = p_id;
    elsif p_ghl_status = 'failed' then
      update campaign_instances set status = 'FAILED', status_reason = 'ghl_reported_failed', last_error = 'GHL reports the campaign failed', dispatch_state = 'unknown' where id = p_id;
      perform raise_alert('dispatch_failed', 'GHL reports the campaign failed', 'critical', p_id, c.tenant_id);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function list_cancel_requests(p_limit int default 100) returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('campaign_id', c.id, 'ghl_location_id', t.ghl_location_id, 'ghl_campaign_id', c.ghl_campaign_id)
  from campaign_instances c join tenants t on t.id = c.tenant_id
  where c.cancel_requested_at is not null and c.ghl_campaign_id is not null
  order by c.cancel_requested_at limit p_limit
$$;

create function record_cancel_result(p_id uuid, p_ok boolean, p_message text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  select * into c from campaign_instances where id = p_id for update;
  perform write_audit(case when p_ok then 'dispatch.ghl_deleted' else 'dispatch.ghl_delete_failed' end, c.tenant_id, p_id, c.edition_id, jsonb_build_object('ghl_campaign_id', c.ghl_campaign_id, 'message', p_message));
  if p_ok then
    update campaign_instances set ghl_campaign_id = null, ghl_draft_hash = null, cancel_requested_at = null where id = p_id;
  else
    perform raise_alert('ghl_cancel_failed', 'Could not delete the campaign in GHL, and it may still send. Check the subaccount now: ' || coalesce(p_message, ''), 'critical', p_id, c.tenant_id);
  end if;
  return jsonb_build_object('ok', p_ok);
end $$;

create function claim_ops_alerts(p_limit int default 200) returns setof jsonb language plpgsql security definer set search_path = public as $$
declare recipient text := setting('ops_alert_email') #>> '{}';
begin
  if recipient is null then return; end if; -- alerts wait until someone is set to receive them
  return query
  with picked as (select id from ops_alerts where claimed_at is null order by id limit p_limit for update skip locked),
  done as (update ops_alerts a set claimed_at = now() from picked where a.id = picked.id returning a.*)
  select jsonb_build_object('id', id, 'severity', severity, 'kind', kind, 'message', message, 'notify_email', recipient) from done;
end $$;

create function record_workflow_error(p_workflow text, p_node text, p_message text, p_execution text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor', 'n8n', true);
  perform write_audit('workflow.error', null, null, null, jsonb_build_object('workflow', p_workflow, 'node', p_node, 'message', p_message, 'execution', p_execution));
  perform raise_alert('workflow_error', p_workflow || ' failed at ' || coalesce(p_node, 'unknown node') || ': ' || p_message, 'critical');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- operator actions

create function operator_hold(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  perform require_role('admin', 'operator');
  select * into c from campaign_instances where id = p_id for update;
  perform set_status(p_id, 'HELD', coalesce(p_reason, 'operator_hold'));
  if c.status = 'SCHEDULED' then perform request_ghl_cancel(p_id); end if;
  perform revoke_review_tokens(p_id);
  update campaign_instances set dispatch_state = 'none' where id = p_id and dispatch_state = 'retry_safe';
end $$;

create function operator_cancel(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'operator');
  perform set_status(p_id, 'CANCELED', coalesce(p_reason, 'operator_cancel'));
  perform request_ghl_cancel(p_id);
  perform revoke_review_tokens(p_id);
end $$;

create function operator_retry(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  perform require_role('admin', 'operator');
  select * into c from campaign_instances where id = p_id for update;
  if c.status <> 'FAILED' then raise exception 'Only failed campaigns can be retried'; end if;
  if c.dispatch_state = 'unknown' then raise exception 'The prior send outcome is unknown. It must be reconciled with GHL before a retry.'; end if;
  if c.rendered_html_hash is null then
    perform reset_for_render(p_id, 'operator_retry');
    return;
  end if;
  update campaign_instances set status = 'APPROVED_FOR_SEND', status_reason = 'operator_retry', dispatch_state = 'retry_safe', dispatch_attempts = 0, last_error = null,
    dead_lettered_at = null, next_attempt_at = now(), scheduled_at = greatest(scheduled_at, now() + interval '15 minutes') where id = p_id;
end $$;

create function operator_release(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances; p newsletter_preferences; deadline timestamptz;
begin
  perform require_role('admin', 'operator');
  select * into c from campaign_instances where id = p_id for update;
  select * into p from newsletter_preferences where tenant_id = c.tenant_id;
  if c.status <> 'HELD' then raise exception 'Only held campaigns can be released'; end if;
  if c.rendered_html_hash is null then
    perform reset_for_render(p_id, 'operator_release');
    return;
  end if;
  if p.review_mode = 'review' then
    if has_valid_approval(p_id, c.rendered_html_hash) then
      update campaign_instances set status = 'APPROVED_FOR_SEND', status_reason = 'operator_release', dispatch_state = 'none', next_attempt_at = null,
        scheduled_at = greatest(scheduled_at, now() + interval '15 minutes') where id = p_id;
    else
      -- Releasing never counts as consent: the reviewer gets a fresh window.
      deadline := greatest(c.review_deadline, now() + make_interval(hours => p.approval_deadline_hours));
      update campaign_instances set status = 'CLIENT_REVIEW_PENDING', status_reason = 'operator_release', review_deadline = deadline, review_invite_requested_at = now(),
        review_invite_sent_at = null, scheduled_at = greatest(scheduled_at, deadline + interval '1 hour') where id = p_id;
    end if;
  else
    update campaign_instances set status = 'AUTO_QUEUED', status_reason = 'operator_release', scheduled_at = greatest(scheduled_at, now() + interval '15 minutes') where id = p_id;
    update campaign_instances set status = 'APPROVED_FOR_SEND', dispatch_state = 'none', next_attempt_at = null where id = p_id;
  end if;
end $$;

create function operator_rerender(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  perform require_role('admin', 'operator');
  select * into c from campaign_instances where id = p_id;
  if c.status in ('SENT', 'SENDING', 'CANCELED', 'SCHEDULED') then raise exception 'A % campaign cannot be re-rendered. Hold it first.', c.status; end if;
  perform reset_for_render(p_id, coalesce(p_reason, 'operator_rerender'));
end $$;

create function operator_resend_invite(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  perform require_role('admin', 'operator');
  select * into c from campaign_instances where id = p_id;
  if c.status <> 'CLIENT_REVIEW_PENDING' then raise exception 'This campaign is not awaiting review'; end if;
  update campaign_instances set review_invite_requested_at = now(), review_invite_sent_at = null where id = p_id;
  perform write_audit('review.invite_requested', c.tenant_id, p_id, c.edition_id, jsonb_build_object('reason', p_reason));
end $$;

create function operator_revoke_approval(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare c campaign_instances;
begin
  perform require_role('admin', 'operator');
  select * into c from campaign_instances where id = p_id for update;
  insert into approval_events (campaign_id, tenant_id, edition_id, decision, version_hash, reviewer_identity, notes)
  values (p_id, c.tenant_id, c.edition_id, 'revoked', c.rendered_html_hash, current_actor(), p_reason);
  perform write_audit('approval.revoked', c.tenant_id, p_id, c.edition_id, jsonb_build_object('reason', p_reason));
  perform set_status(p_id, 'HELD', 'approval_revoked');
  if c.status = 'SCHEDULED' then perform request_ghl_cancel(p_id); end if;
end $$;

create function hold_scheduled_for_pause(p_scope pause_scope_t, p_value text, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  -- A GHL-scheduled campaign would otherwise still go out, so pausing also pulls it back.
  for c in
    select ci.id from campaign_instances ci join tenants t on t.id = ci.tenant_id
    where ci.status = 'SCHEDULED' and ci.scheduled_at > now() and (
      p_scope = 'global' or (p_scope = 'division' and t.division::text = p_value) or (p_scope = 'industry' and t.industry = p_value)
      or (p_scope = 'tenant' and t.id::text = p_value) or (p_scope = 'edition' and ci.edition_id::text = p_value))
    for update of ci
  loop
    perform set_status(c.id, 'HELD', 'paused: ' || coalesce(p_reason, ''));
    perform request_ghl_cancel(c.id);
  end loop;
end $$;

create function set_pause(p_scope pause_scope_t, p_value text, p_active boolean, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare value text := case when p_scope = 'global' then '*' else p_value end;
begin
  perform require_role('admin', 'operator');
  insert into pause_switches as s (scope, scope_value, active, reason, updated_by)
  values (p_scope, value, p_active, p_reason, current_actor())
  on conflict (scope, scope_value) do update set active = p_active, reason = p_reason, updated_by = current_actor(), updated_at = now();
  perform write_audit('pause.set', case when p_scope = 'tenant' then value::uuid end, null, case when p_scope = 'edition' then value::uuid end, jsonb_build_object('scope', p_scope, 'value', value, 'active', p_active, 'reason', p_reason));
  if p_active then perform hold_scheduled_for_pause(p_scope, value, p_reason); end if;
end $$;

create function set_setting(p_key text, p_value jsonb) returns void language plpgsql security definer set search_path = public as $$
declare before_value jsonb;
begin
  perform require_role('admin');
  select value into before_value from system_settings where key = p_key;
  if not found then raise exception 'Unknown setting %', p_key; end if;
  update system_settings set value = coalesce(p_value, 'null'::jsonb), updated_at = now() where key = p_key;
  perform write_audit('settings.changed', null, null, null, jsonb_build_object('key', p_key, 'from', before_value, 'to', p_value));
end $$;

create function log_audit_export(p_search text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Staff only' using errcode = '42501'; end if;
  perform write_audit('audit.exported', null, null, null, jsonb_build_object('search', p_search));
end $$;

-- ---------------------------------------------------------------- tenants

create function go_live_checklist(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tenants; b brand_profiles; p newsletter_preferences; pl plan_entitlements;
begin
  if not (is_staff() or p_tenant in (select my_tenants()) or auth.uid() is null) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into t from tenants where id = p_tenant;
  select * into b from brand_profiles where tenant_id = p_tenant;
  select * into p from newsletter_preferences where tenant_id = p_tenant;
  select * into pl from plan_entitlements where plan_key = t.plan_key;
  return jsonb_build_array(
    jsonb_build_object('item', 'identity', 'label', 'Business identity and legal name', 'passed', coalesce(b.legal_business_name, '') <> ''),
    jsonb_build_object('item', 'postal', 'label', 'Postal address on file', 'passed', coalesce(b.postal_address, '') <> ''),
    jsonb_build_object('item', 'sender', 'label', 'Verified sender identity', 'passed', coalesce(b.sender_verified, false) and coalesce(b.from_email, '') <> ''),
    jsonb_build_object('item', 'domain', 'label', 'Sending domain authenticated', 'passed', coalesce(b.domain_authenticated, false)),
    jsonb_build_object('item', 'title', 'label', 'Newsletter title set', 'passed', coalesce(b.newsletter_name, '') <> ''),
    jsonb_build_object('item', 'template', 'label', 'Template allowed by plan', 'passed', exists (select 1 from plan_templates pt where pt.plan_key = t.plan_key and pt.template_key = p.template_key)),
    jsonb_build_object('item', 'reviewer', 'label', 'Reviewer set (review mode only)', 'passed', p.review_mode <> 'review' or coalesce(p.reviewer_email, '') <> ''),
    jsonb_build_object('item', 'segment', 'label', 'Contact segment selected', 'passed', cardinality(p.allowed_segments) > 0),
    jsonb_build_object('item', 'ghl_user', 'label', 'GHL user id set', 'passed', coalesce(p.ghl_user_id, '') <> ''),
    jsonb_build_object('item', 'opt_in', 'label', 'Tenant opted in', 'passed', t.opted_in),
    jsonb_build_object('item', 'compliance', 'label', 'Compliance acknowledged', 'passed', t.compliance_acknowledged_at is not null),
    jsonb_build_object('item', 'plan_terms', 'label', 'Plan terms signed off', 'passed', not pl.signoff_pending),
    jsonb_build_object('item', 'test_email', 'label', 'Test email passed', 'passed', t.test_email_passed_at is not null)
  );
end $$;

create function set_live_send(p_tenant uuid, p_enabled boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'operator');
  if p_enabled and exists (select 1 from jsonb_array_elements(go_live_checklist(p_tenant)) i where i->>'passed' = 'false') then
    raise exception 'Finish the go-live checklist before enabling live sending.';
  end if;
  update tenants set live_send_enabled = p_enabled, test_mode = not p_enabled, updated_at = now() where id = p_tenant;
  perform write_audit('tenant.live_send', p_tenant, null, null, jsonb_build_object('enabled', p_enabled));
end $$;

create function mark_test_email_passed(p_tenant uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'operator');
  update tenants set test_email_passed_at = now() where id = p_tenant;
  perform write_audit('tenant.test_email_passed', p_tenant, null, null);
end $$;

create function operator_change_cadence(p_tenant uuid, p_cadence cadence_t) returns void language plpgsql security definer set search_path = public as $$
declare before_value cadence_t;
begin
  perform require_role('admin', 'operator');
  if not exists (select 1 from tenants t join plan_entitlements pl on pl.plan_key = t.plan_key where t.id = p_tenant and p_cadence = any (pl.allowed_cadences)) then
    raise exception 'That cadence is not allowed on this plan.';
  end if;
  select cadence into before_value from newsletter_preferences where tenant_id = p_tenant;
  update newsletter_preferences set cadence = p_cadence, updated_at = now() where tenant_id = p_tenant;
  perform write_audit('tenant.cadence_changed', p_tenant, null, null, jsonb_build_object('from', before_value, 'to', p_cadence));
end $$;

create function changed_fields(p_old jsonb, p_new jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', p_old->n.key, 'to', n.value)), '{}')
  from jsonb_each(p_new) n where n.key not in ('updated_at', 'created_at') and p_old->n.key is distinct from n.value
$$;

create function save_tenant(p_tenant jsonb, p_brand jsonb, p_prefs jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare
  id_ uuid := nullif(p_tenant->>'id', '')::uuid; t tenants; t0 jsonb; b brand_profiles; b0 jsonb; p newsletter_preferences; p0 jsonb; pl plan_entitlements; plan_changed boolean := false;
begin
  perform require_role('admin', 'operator');
  if id_ is null then
    insert into tenants (ghl_location_id, name, division, industry, plan_key)
    values (p_tenant->>'ghl_location_id', p_tenant->>'name', (p_tenant->>'division')::division_t, p_tenant->>'industry', p_tenant->>'plan_key')
    returning id into id_;
    insert into brand_profiles (tenant_id) values (id_);
    insert into newsletter_preferences (tenant_id) values (id_);
    perform write_audit('tenant.created', id_, null, null, jsonb_build_object('name', p_tenant->>'name'));
  end if;
  select * into t from tenants where id = id_ for update;
  select * into b from brand_profiles where tenant_id = id_ for update;
  select * into p from newsletter_preferences where tenant_id = id_ for update;
  t0 := to_jsonb(t); b0 := to_jsonb(b); p0 := to_jsonb(p);

  -- Only editable fields are copied. Live-send flags change through set_live_send and its checklist.
  select * into t from jsonb_populate_record(t, p_tenant - 'id' - 'created_at' - 'updated_at' - 'live_send_enabled' - 'test_mode' - 'test_email_passed_at' - 'biweekly_offset' - 'stagger_minutes' - 'ghl_token_secret');
  select * into b from jsonb_populate_record(b, p_brand - 'tenant_id' - 'updated_at');
  select * into p from jsonb_populate_record(p, p_prefs - 'tenant_id' - 'updated_at' - 'fallback_action');
  select * into pl from plan_entitlements where plan_key = t.plan_key;
  if pl.division <> t.division then raise exception 'Plan % is not available in this division', t.plan_key; end if;
  plan_changed := t0->>'plan_key' is distinct from t.plan_key;

  if p.template_key is not null and not exists (select 1 from plan_templates pt where pt.plan_key = t.plan_key and pt.template_key = p.template_key) then
    -- A downgrade clears the choice rather than failing, and past campaigns keep their pinned version.
    if plan_changed then p.template_key := null; else raise exception 'That design is not included in this plan.'; end if;
  end if;
  if not p.cadence = any (pl.allowed_cadences) then
    if plan_changed then p.cadence := pl.default_cadence; else raise exception 'That cadence is not allowed on this plan.'; end if;
  end if;

  update tenants set ghl_location_id = t.ghl_location_id, name = t.name, division = t.division, industry = t.industry, plan_key = t.plan_key, entitlement_status = t.entitlement_status,
    timezone = t.timezone, locale = t.locale, service_areas = t.service_areas, status = t.status, opted_in = t.opted_in, compliance_acknowledged_at = t.compliance_acknowledged_at, updated_at = now()
  where id = id_;
  update brand_profiles set newsletter_name = coalesce(b.newsletter_name, ''), logo_url = b.logo_url, primary_color = b.primary_color, secondary_color = b.secondary_color, legal_business_name = b.legal_business_name,
    from_name = b.from_name, from_email = b.from_email, reply_to = b.reply_to, sender_verified = b.sender_verified, domain_authenticated = b.domain_authenticated, phone = b.phone, website = b.website,
    booking_url = b.booking_url, postal_address = b.postal_address, social_links = b.social_links, local_note = b.local_note, offer_headline = b.offer_headline, offer_body = b.offer_body,
    offer_cta_label = b.offer_cta_label, offer_url = b.offer_url, offer_expires_at = b.offer_expires_at, offer_approved = b.offer_approved, updated_at = now()
  where tenant_id = id_;
  update newsletter_preferences set template_key = p.template_key, cadence = p.cadence, preferred_weekday = p.preferred_weekday, preferred_local_time = p.preferred_local_time, review_mode = p.review_mode,
    reviewer_name = p.reviewer_name, reviewer_email = p.reviewer_email, approval_deadline_hours = p.approval_deadline_hours, allowed_segments = p.allowed_segments, test_contact_ids = p.test_contact_ids,
    ghl_user_id = p.ghl_user_id, updated_at = now()
  where tenant_id = id_;

  perform write_audit('tenant.updated', id_, null, null, jsonb_build_object(
    'tenant', changed_fields(t0, (select to_jsonb(x) from tenants x where x.id = id_)),
    'brand', changed_fields(b0, (select to_jsonb(x) from brand_profiles x where x.tenant_id = id_)),
    'preferences', changed_fields(p0, (select to_jsonb(x) from newsletter_preferences x where x.tenant_id = id_))
  ));
  if t.status = 'paused' and t0->>'status' = 'active' then perform hold_scheduled_for_pause('tenant', id_::text, 'tenant_paused'); end if;
  return id_;
end $$;

-- ---------------------------------------------------------------- content and editions

create function save_content(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare id_ uuid := nullif(p->>'id', '')::uuid; c content_items;
begin
  perform require_role('admin', 'editor');
  if id_ is null then
    insert into content_items (division, industry, headline, created_by)
    values ((p->>'division')::division_t, p->>'industry', coalesce(p->>'headline', ''), auth.uid()) returning id into id_;
    perform write_audit('content.created', null, null, null, jsonb_build_object('content', id_));
  end if;
  select * into c from content_items where id = id_ for update;
  if c.status <> 'draft' then raise exception 'Only drafts can be edited. Create a new version instead.'; end if;
  update content_items set
    division = coalesce((p->>'division')::division_t, division), industry = coalesce(p->>'industry', industry), regions = case when p ? 'regions' then jsonb_text_array(p->'regions') else regions end,
    season = nullif(p->>'season', ''), headline = coalesce(p->>'headline', headline), teaser = coalesce(p->>'teaser', teaser), body = coalesce(p->>'body', body), image_url = nullif(p->>'image_url', ''),
    image_alt = nullif(p->>'image_alt', ''), image_license = nullif(p->>'image_license', ''), cta_class = nullif(p->>'cta_class', ''), cta_label = nullif(p->>'cta_label', ''), expires_at = nullif(p->>'expires_at', '')::timestamptz
  where id = id_;
  return id_;
end $$;

create function content_advance(p_id uuid, p_to content_status_t, p_notes text default null) returns void language plpgsql security definer set search_path = public as $$
declare c content_items;
begin
  perform require_role('admin', 'editor');
  select * into c from content_items where id = p_id for update;
  if not ((c.status, p_to)::text in (
    '(draft,editorial_review)', '(editorial_review,fact_rights_review)', '(editorial_review,draft)', '(editorial_review,rejected)',
    '(fact_rights_review,approved)', '(fact_rights_review,draft)', '(fact_rights_review,rejected)', '(approved,retired)', '(rejected,draft)'
  )) then
    raise exception 'A story cannot move from % to %', c.status, p_to;
  end if;
  if p_to = 'approved' and c.image_url is not null and coalesce(c.image_license, '') = '' then
    raise exception 'Record the image license before approving this story.';
  end if;
  update content_items set status = p_to, review_notes = coalesce(p_notes, review_notes),
    approved_by = case when p_to = 'approved' then auth.uid() else approved_by end, approved_at = case when p_to = 'approved' then now() else approved_at end
  where id = p_id;
  perform write_audit('content.status', null, null, null, jsonb_build_object('content', p_id, 'from', c.status, 'to', p_to, 'notes', p_notes));
end $$;

create function content_new_version(p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare c content_items; id_ uuid; next_version int;
begin
  perform require_role('admin', 'editor');
  select * into c from content_items where id = p_id;
  select max(version) + 1 into next_version from content_items where content_id = c.content_id;
  insert into content_items (content_id, version, division, industry, regions, season, headline, teaser, body, image_url, image_alt, image_license, cta_class, cta_label, expires_at, created_by)
  values (c.content_id, next_version, c.division, c.industry, c.regions, c.season, c.headline, c.teaser, c.body, c.image_url, c.image_alt, c.image_license, c.cta_class, c.cta_label, c.expires_at, auth.uid())
  returning id into id_;
  perform write_audit('content.new_version', null, null, null, jsonb_build_object('from', p_id, 'to', id_, 'version', next_version));
  return id_;
end $$;

-- Any edit after submission goes back to draft. An edit after approval also creates a new version,
-- invalidates every unsent tenant campaign and requires re-approval.
create function reopen_edition(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare e editions; c campaign_instances;
begin
  select * into e from editions where id = p_id for update;
  if e.status = 'approved' then
    update editions set status = 'draft', version = version + 1, central_approved_at = null, central_approved_by = null, approved_snapshot = null, updated_at = now() where id = p_id;
    perform write_audit('edition.reopened', null, null, p_id, jsonb_build_object('reason', p_reason, 'previous_version', e.version));
    for c in select * from campaign_instances where edition_id = p_id and status in ('READY_TO_RENDER', 'RENDERED', 'CENTRAL_APPROVED', 'AUTO_QUEUED', 'CLIENT_REVIEW_PENDING', 'APPROVED_FOR_SEND', 'SCHEDULED') for update loop
      perform revoke_review_tokens(c.id);
      perform set_status(c.id, 'HELD', 'edition_changed');
      perform request_ghl_cancel(c.id);
    end loop;
    if exists (select 1 from campaign_instances where edition_id = p_id and status = 'SENDING') then
      perform raise_alert('edition_changed_while_sending', 'An edition was edited while one of its campaigns was sending.', 'critical');
    end if;
  elsif e.status in ('pending_approval', 'rejected') then
    update editions set status = 'draft', updated_at = now() where id = p_id;
  end if;
end $$;

create function save_edition(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare id_ uuid := nullif(p->>'id', '')::uuid; e editions; n editions;
begin
  perform require_role('admin', 'editor');
  if id_ is null then
    insert into editions (division, industry, publication_week, subject, preview_text, eligible_plans)
    values ((p->>'division')::division_t, p->>'industry', (p->>'publication_week')::date, coalesce(p->>'subject', ''), coalesce(p->>'preview_text', ''), jsonb_text_array(p->'eligible_plans'))
    returning id into id_;
    perform write_audit('edition.created', null, null, id_);
    return id_;
  end if;
  select * into e from editions where id = id_ for update;
  n := e;
  if p ? 'subject' then n.subject := coalesce(p->>'subject', ''); end if;
  if p ? 'preview_text' then n.preview_text := coalesce(p->>'preview_text', ''); end if;
  if p ? 'eligible_plans' then n.eligible_plans := jsonb_text_array(p->'eligible_plans'); end if;
  if p ? 'embargo_at' then n.embargo_at := nullif(p->>'embargo_at', '')::timestamptz; end if;
  if p ? 'expires_at' then n.expires_at := nullif(p->>'expires_at', '')::timestamptz; end if;
  if (n.subject, n.preview_text, n.eligible_plans, n.embargo_at, n.expires_at) is not distinct from (e.subject, e.preview_text, e.eligible_plans, e.embargo_at, e.expires_at) then
    return id_; -- nothing changed, so approval stands
  end if;
  perform reopen_edition(id_, 'details_changed');
  update editions set subject = n.subject, preview_text = n.preview_text, eligible_plans = n.eligible_plans, embargo_at = n.embargo_at, expires_at = n.expires_at, updated_at = now() where id = id_;
  return id_;
end $$;

create function set_edition_items(p_edition uuid, p_items jsonb) returns void language plpgsql security definer set search_path = public as $$
declare current_items jsonb; next_items jsonb;
begin
  perform require_role('admin', 'editor');
  select coalesce(jsonb_agg(jsonb_build_object('c', content_item_id, 's', slot, 'p', position) order by content_item_id), '[]') into current_items from edition_items where edition_id = p_edition;
  select coalesce(jsonb_agg(jsonb_build_object('c', x->>'content_item_id', 's', x->>'slot', 'p', (x->>'position')::int) order by x->>'content_item_id'), '[]') into next_items from jsonb_array_elements(p_items) x;
  if current_items = next_items then return; end if;
  if (select count(*) from jsonb_array_elements(p_items) x where x->>'slot' = 'hero') > 1 then raise exception 'An edition has one hero story.'; end if;
  perform reopen_edition(p_edition, 'items_changed');
  delete from edition_items where edition_id = p_edition;
  insert into edition_items (edition_id, content_item_id, slot, position)
  select p_edition, (x->>'content_item_id')::uuid, x->>'slot', (x->>'position')::int from jsonb_array_elements(p_items) x;
  perform write_audit('edition.items_changed', null, null, p_edition, jsonb_build_object('items', next_items));
end $$;

create function edition_submit(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare e editions;
begin
  perform require_role('admin', 'editor');
  select * into e from editions where id = p_id for update;
  if e.status not in ('draft', 'rejected') then raise exception 'This edition has already been submitted.'; end if;
  if coalesce(e.subject, '') = '' then raise exception 'Add a subject line first.'; end if;
  if not exists (select 1 from edition_items where edition_id = p_id and slot = 'hero') then raise exception 'Choose a hero story first.'; end if;
  update editions set status = 'pending_approval', notes = null, updated_at = now() where id = p_id;
  perform write_audit('edition.submitted', null, null, p_id);
end $$;

create function edition_approve(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare e editions;
begin
  perform require_role('admin', 'editor');
  select * into e from editions where id = p_id for update;
  if e.status <> 'pending_approval' then raise exception 'Submit the edition for approval first.'; end if;
  if exists (select 1 from edition_items ei join content_items c on c.id = ei.content_item_id where ei.edition_id = p_id and c.status <> 'approved') then
    raise exception 'Every story must still be approved.';
  end if;
  update editions set status = 'approved', central_approved_at = now(), central_approved_by = auth.uid(), updated_at = now(),
    approved_snapshot = (select jsonb_agg(jsonb_build_object('content_item_id', c.id, 'content_id', c.content_id, 'version', c.version, 'slot', ei.slot, 'position', ei.position) order by ei.position)
      from edition_items ei join content_items c on c.id = ei.content_item_id where ei.edition_id = p_id)
  where id = p_id;
  perform write_audit('edition.approved', null, null, p_id, jsonb_build_object('version', e.version));
end $$;

create function edition_reject(p_id uuid, p_notes text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'editor');
  update editions set status = 'rejected', notes = p_notes, updated_at = now() where id = p_id and status = 'pending_approval';
  if not found then raise exception 'Only an edition awaiting approval can be rejected.'; end if;
  perform write_audit('edition.rejected', null, null, p_id, jsonb_build_object('notes', p_notes));
end $$;

-- ---------------------------------------------------------------- views for the dashboard

create view campaign_overview with (security_invoker = true) as
select c.id, c.tenant_id, t.name as tenant_name, t.timezone, t.division, t.industry, t.plan_key, p.review_mode, c.edition_id, e.subject as edition_subject, e.publication_week,
  c.edition_version, c.status, c.status_reason, c.scheduled_at, c.sent_at, c.review_deadline, c.ghl_campaign_id, c.dispatch_state, c.dispatch_attempts, c.last_error, c.rendered_html_hash,
  c.idempotency_key, c.dead_lettered_at, c.cancel_requested_at
from campaign_instances c join tenants t on t.id = c.tenant_id join editions e on e.id = c.edition_id left join newsletter_preferences p on p.tenant_id = c.tenant_id;

create view tenant_overview with (security_invoker = true) as
select t.*, p.template_key, p.cadence, p.review_mode, b.newsletter_name
from tenants t left join newsletter_preferences p on p.tenant_id = t.id left join brand_profiles b on b.tenant_id = t.id;

create function dashboard_cards(p_filters jsonb default '{}') returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'); r record; rate jsonb := setting('cost_per_1000_emails_usd');
begin
  with rows as (
    select o.* from campaign_overview o
    where (f->>'division' is null or o.division::text = f->>'division') and (f->>'industry' is null or o.industry = f->>'industry')
      and (f->>'plan_key' is null or o.plan_key = f->>'plan_key') and (f->>'tenant_id' is null or o.tenant_id::text = f->>'tenant_id')
      and (f->>'edition_id' is null or o.edition_id::text = f->>'edition_id') and (f->>'review_mode' is null or o.review_mode::text = f->>'review_mode')
      and (f->>'status' is null or o.status::text = f->>'status') and (f->>'send_date' is null or (o.scheduled_at at time zone 'UTC')::date = (f->>'send_date')::date)
  )
  select count(*) filter (where status = 'CLIENT_REVIEW_PENDING') as pending, count(*) filter (where status in ('SCHEDULED', 'SENDING')) as scheduled,
    count(*) filter (where status = 'SENT') as sent, count(*) filter (where status = 'FAILED') as failed, count(*) filter (where status = 'HELD') as held,
    (select coalesce(sum(coalesce(m.bounced, 0) + coalesce(m.unsubscribed, 0) + coalesce(m.suppressed, 0)), 0) from campaign_metrics m join rows x on x.id = m.campaign_id) as invalid,
    (select coalesce(sum(m.recipients), 0) from campaign_metrics m join rows x on x.id = m.campaign_id where x.status in ('APPROVED_FOR_SEND', 'SCHEDULED', 'SENDING')) as recipients,
    (select coalesce(sum(m.recipients), 0) from campaign_metrics m join rows x on x.id = m.campaign_id) as all_recipients
  into r from rows;
  return jsonb_build_object(
    'active_tenants', (select count(*) from tenants where status = 'active' and entitlement_status = 'active'),
    'upcoming_editions', (select count(*) from editions where publication_week >= (date_trunc('week', now() at time zone 'UTC'))::date),
    'pending_approvals', r.pending, 'scheduled', r.scheduled, 'sent', r.sent, 'failed', r.failed, 'held', r.held,
    'unsubscribed_invalid', r.invalid, 'scheduled_recipients', r.recipients,
    'cost_estimate_usd', case when rate is null or rate = 'null'::jsonb then null else r.all_recipients / 1000.0 * (rate #>> '{}')::numeric end
  );
end $$;

-- ---------------------------------------------------------------- row level security

do $$
declare name text;
begin
  foreach name in array array[
    'staff_roles', 'industries', 'plan_entitlements', 'master_templates', 'plan_templates', 'template_versions', 'tenants', 'tenant_users', 'brand_profiles', 'newsletter_preferences',
    'content_items', 'editions', 'edition_items', 'campaign_instances', 'campaign_transitions', 'approval_events', 'review_tokens', 'pause_switches', 'campaign_metrics', 'ghl_api_usage',
    'system_settings', 'audit_log', 'ops_alerts'
  ] loop
    execute format('alter table %I enable row level security', name);
    execute format('revoke all on %I from anon', name);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', name);
  end loop;

  -- Staff read everything except tokens. All writes go through the functions above.
  foreach name in array array[
    'industries', 'plan_entitlements', 'master_templates', 'plan_templates', 'template_versions', 'content_items', 'editions', 'edition_items', 'campaign_transitions',
    'pause_switches', 'ghl_api_usage', 'system_settings', 'ops_alerts'
  ] loop
    execute format('create policy staff_read on %I for select to authenticated using (is_staff())', name);
  end loop;

  -- Tenant-owned rows: staff, or that tenant's own users, and nobody else.
  foreach name in array array['brand_profiles', 'newsletter_preferences', 'campaign_instances', 'approval_events', 'campaign_metrics', 'audit_log'] loop
    execute format('create policy tenant_read on %I for select to authenticated using (is_staff() or tenant_id in (select my_tenants()))', name);
  end loop;
end $$;

create policy tenant_read on tenants for select to authenticated using (is_staff() or id in (select my_tenants()));
create policy own_links on tenant_users for select to authenticated using (user_id = auth.uid() or is_staff());
create policy own_role on staff_roles for select to authenticated using (user_id = auth.uid());
-- review_tokens has no policy on purpose: only the Edge Functions reach it, through the service role.

grant select on campaign_overview, tenant_overview to authenticated;
revoke all on campaign_overview, tenant_overview from anon;

-- Functions are executable by PUBLIC by default, so close everything and then open only what each caller needs.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

grant execute on function is_staff(), staff_role(), my_tenants(), setting(text), dashboard_cards(jsonb), go_live_checklist(uuid), log_audit_export(text),
  operator_hold(uuid, text), operator_cancel(uuid, text), operator_retry(uuid, text), operator_release(uuid, text), operator_rerender(uuid, text), operator_resend_invite(uuid, text),
  operator_revoke_approval(uuid, text), operator_change_cadence(uuid, cadence_t), save_tenant(jsonb, jsonb, jsonb), set_live_send(uuid, boolean), mark_test_email_passed(uuid),
  set_pause(pause_scope_t, text, boolean, text), set_setting(text, jsonb), save_content(jsonb), content_advance(uuid, content_status_t, text), content_new_version(uuid),
  save_edition(jsonb), set_edition_items(uuid, jsonb), edition_submit(uuid), edition_approve(uuid), edition_reject(uuid, text)
to authenticated;

-- The dashboard's Realtime feed (data-flow step 7). The publication only exists on Supabase itself.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table audit_log;
  end if;
end $$;
