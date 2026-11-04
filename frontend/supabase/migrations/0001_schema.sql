-- Archimedes Content Creation & Distribution Engine: core schema.
-- Multi-tenant: every tenant-owned row carries tenant_id. Contacts are never stored here;
-- they stay inside each client's GHL subaccount (spec section 9).

create type division_t as enum ('hsg', 'hospitality');
create type staff_role_t as enum ('admin', 'editor', 'operator');
create type cadence_t as enum ('weekly', 'biweekly');
create type review_mode_t as enum ('auto', 'review');
create type content_status_t as enum ('draft', 'editorial_review', 'fact_rights_review', 'approved', 'rejected', 'retired');
create type edition_status_t as enum ('draft', 'pending_approval', 'approved', 'rejected');
create type dispatch_state_t as enum ('none', 'in_flight', 'unknown', 'retry_safe', 'done');
create type approval_decision_t as enum ('approved', 'revision_requested', 'rejected', 'skipped', 'revoked');
create type pause_scope_t as enum ('global', 'division', 'industry', 'tenant', 'edition');
create type campaign_status_t as enum (
  'NOT_ELIGIBLE', 'READY_TO_RENDER', 'RENDERED', 'CENTRAL_APPROVED',
  'AUTO_QUEUED', 'CLIENT_REVIEW_PENDING', 'APPROVED_FOR_SEND',
  'SCHEDULED', 'SENDING', 'SENT',
  'REVISION_REQUESTED', 'REJECTED', 'HELD', 'FAILED', 'CANCELED'
);

create table staff_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role staff_role_t not null,
  created_at timestamptz not null default now()
);

create table industries (
  key text primary key,
  division division_t not null,
  label text not null,
  unique (division, key)
);

-- The authoritative entitlement record. Pricing is deliberately absent (spec section 2).
create table plan_entitlements (
  plan_key text primary key,
  division division_t not null,
  label text not null,
  default_cadence cadence_t not null,
  allowed_cadences cadence_t[] not null,
  signoff_pending boolean not null default false,
  check (default_cadence = any (allowed_cadences))
);

create table master_templates (
  key text primary key,
  name text not null,
  position int not null
);

create table plan_templates (
  plan_key text not null references plan_entitlements (plan_key) on delete cascade,
  template_key text not null references master_templates (key),
  primary key (plan_key, template_key)
);

-- Immutable once inserted: see guard_template_version trigger.
create table template_versions (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references master_templates (key),
  version int not null,
  mjml_source text not null,
  compiled_html text not null,
  labels jsonb not null default '{}',
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (template_key, version)
);
create unique index template_versions_one_current on template_versions (template_key) where is_current;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  ghl_location_id text not null unique,
  ghl_token_secret text,
  name text not null,
  division division_t not null,
  industry text not null,
  plan_key text not null references plan_entitlements (plan_key),
  entitlement_status text not null default 'active' check (entitlement_status in ('active', 'suspended', 'cancelled')),
  timezone text not null default 'America/Denver',
  locale text not null default 'en-US',
  service_areas text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'paused')),
  opted_in boolean not null default false,
  live_send_enabled boolean not null default false,
  test_mode boolean not null default true,
  test_email_passed_at timestamptz,
  compliance_acknowledged_at timestamptz,
  biweekly_offset smallint not null default floor(random() * 2)::smallint check (biweekly_offset in (0, 1)),
  stagger_minutes smallint not null default floor(random() * 30)::smallint check (stagger_minutes between 0 and 59),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (division, industry) references industries (division, key)
);
create index tenants_industry_idx on tenants (division, industry);

create table tenant_users (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (user_id, tenant_id)
);

create table brand_profiles (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  newsletter_name text not null default '',
  logo_url text,
  primary_color text not null default '#1f3a5f' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null default '#c8553d' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  legal_business_name text,
  from_name text,
  from_email text,
  reply_to text,
  sender_verified boolean not null default false,
  domain_authenticated boolean not null default false,
  phone text,
  website text,
  booking_url text,
  postal_address text,
  social_links jsonb not null default '{}',
  local_note text,
  offer_headline text,
  offer_body text,
  offer_cta_label text,
  offer_url text,
  offer_expires_at timestamptz,
  offer_approved boolean not null default false,
  updated_at timestamptz not null default now()
);

create table newsletter_preferences (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  template_key text references master_templates (key),
  cadence cadence_t not null default 'weekly',
  preferred_weekday smallint not null default 4 check (preferred_weekday between 1 and 7), -- ISO: 1 = Monday, 4 = Thursday
  preferred_local_time time not null default '09:00',
  review_mode review_mode_t not null default 'auto',
  reviewer_name text,
  reviewer_email text,
  approval_deadline_hours int not null default 24 check (approval_deadline_hours between 1 and 168),
  fallback_action text not null default 'hold' check (fallback_action = 'hold'), -- no implied consent, ever
  allowed_segments text[] not null default '{}', -- GHL tag ids
  test_contact_ids text[] not null default '{}', -- GHL contact ids used while in test mode
  ghl_user_id text,
  updated_at timestamptz not null default now()
);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null default gen_random_uuid(), -- stable across versions
  version int not null default 1,
  division division_t not null,
  industry text not null,
  regions text[] not null default '{}', -- empty = not region-specific
  season text,
  headline text not null,
  teaser text not null default '',
  body text not null default '',
  image_url text,
  image_alt text,
  image_license text,
  cta_class text,
  cta_label text,
  expires_at timestamptz,
  status content_status_t not null default 'draft',
  review_notes text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_id, version),
  foreign key (division, industry) references industries (division, key)
);

create table editions (
  id uuid primary key default gen_random_uuid(),
  division division_t not null,
  industry text not null,
  publication_week date not null, -- Monday of the publication week
  version int not null default 1,
  subject text not null default '',
  preview_text text not null default '',
  status edition_status_t not null default 'draft',
  eligible_plans text[] not null default '{}', -- empty = every plan in the division
  embargo_at timestamptz,
  expires_at timestamptz,
  central_approved_by uuid,
  central_approved_at timestamptz,
  approved_snapshot jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division, industry, publication_week),
  check (extract(isodow from publication_week) = 1),
  foreign key (division, industry) references industries (division, key)
);

create table edition_items (
  edition_id uuid not null references editions (id) on delete cascade,
  content_item_id uuid not null references content_items (id),
  slot text not null check (slot in ('hero', 'secondary')),
  position int not null default 0,
  primary key (edition_id, content_item_id)
);

create table campaign_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  edition_id uuid not null references editions (id),
  edition_version int not null,
  variant text not null default 'default',
  template_version_id uuid references template_versions (id),
  idempotency_key text not null unique, -- tenant + edition + variant
  status campaign_status_t not null default 'READY_TO_RENDER',
  status_reason text,
  rendered_subject text,
  rendered_html text,
  rendered_text text,
  rendered_html_hash text,
  rendered_at timestamptz,
  render_claimed_at timestamptz,
  review_deadline timestamptz,
  review_invite_requested_at timestamptz,
  review_invite_sent_at timestamptz,
  ghl_campaign_id text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  dispatch_state dispatch_state_t not null default 'none',
  dispatch_attempts int not null default 0,
  dispatch_started_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  dead_lettered_at timestamptz,
  cancel_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, edition_id, variant)
);
create index campaign_status_idx on campaign_instances (status, scheduled_at);
create index campaign_tenant_idx on campaign_instances (tenant_id, created_at desc);
create index campaign_edition_idx on campaign_instances (edition_id);

-- Legal status moves. Enforced by transition_campaign.
create table campaign_transitions (
  from_status campaign_status_t not null,
  to_status campaign_status_t not null,
  primary key (from_status, to_status)
);
insert into campaign_transitions (from_status, to_status)
select f::campaign_status_t, t::campaign_status_t from (values
  ('NOT_ELIGIBLE', 'READY_TO_RENDER'), ('NOT_ELIGIBLE', 'CANCELED'),
  ('READY_TO_RENDER', 'RENDERED'), ('READY_TO_RENDER', 'NOT_ELIGIBLE'), ('READY_TO_RENDER', 'HELD'), ('READY_TO_RENDER', 'FAILED'), ('READY_TO_RENDER', 'CANCELED'),
  ('RENDERED', 'CENTRAL_APPROVED'), ('RENDERED', 'READY_TO_RENDER'), ('RENDERED', 'HELD'), ('RENDERED', 'CANCELED'),
  ('CENTRAL_APPROVED', 'AUTO_QUEUED'), ('CENTRAL_APPROVED', 'CLIENT_REVIEW_PENDING'), ('CENTRAL_APPROVED', 'READY_TO_RENDER'), ('CENTRAL_APPROVED', 'HELD'), ('CENTRAL_APPROVED', 'CANCELED'),
  ('AUTO_QUEUED', 'APPROVED_FOR_SEND'), ('AUTO_QUEUED', 'READY_TO_RENDER'), ('AUTO_QUEUED', 'HELD'), ('AUTO_QUEUED', 'CANCELED'),
  ('CLIENT_REVIEW_PENDING', 'APPROVED_FOR_SEND'), ('CLIENT_REVIEW_PENDING', 'REVISION_REQUESTED'), ('CLIENT_REVIEW_PENDING', 'REJECTED'), ('CLIENT_REVIEW_PENDING', 'READY_TO_RENDER'), ('CLIENT_REVIEW_PENDING', 'HELD'), ('CLIENT_REVIEW_PENDING', 'CANCELED'),
  ('APPROVED_FOR_SEND', 'SCHEDULED'), ('APPROVED_FOR_SEND', 'READY_TO_RENDER'), ('APPROVED_FOR_SEND', 'HELD'), ('APPROVED_FOR_SEND', 'FAILED'), ('APPROVED_FOR_SEND', 'CANCELED'),
  ('SCHEDULED', 'SENDING'), ('SCHEDULED', 'SENT'), ('SCHEDULED', 'HELD'), ('SCHEDULED', 'FAILED'), ('SCHEDULED', 'CANCELED'),
  ('SENDING', 'SENT'), ('SENDING', 'FAILED'),
  ('REVISION_REQUESTED', 'READY_TO_RENDER'), ('REVISION_REQUESTED', 'CANCELED'),
  ('REJECTED', 'READY_TO_RENDER'), ('REJECTED', 'CANCELED'),
  ('HELD', 'READY_TO_RENDER'), ('HELD', 'AUTO_QUEUED'), ('HELD', 'CLIENT_REVIEW_PENDING'), ('HELD', 'APPROVED_FOR_SEND'), ('HELD', 'CANCELED'),
  ('FAILED', 'READY_TO_RENDER'), ('FAILED', 'APPROVED_FOR_SEND'), ('FAILED', 'CANCELED')
) as v (f, t);

-- Append-only: see guard_append_only trigger.
create table approval_events (
  id bigint generated always as identity primary key,
  campaign_id uuid references campaign_instances (id),
  tenant_id uuid references tenants (id),
  edition_id uuid references editions (id),
  decision approval_decision_t not null,
  version_hash text,
  reviewer_identity text,
  requested_at timestamptz,
  decided_at timestamptz not null default now(),
  notes text,
  ip text,
  user_agent text
);
create index approval_events_campaign_idx on approval_events (campaign_id, id desc);

create table review_tokens (
  jti uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaign_instances (id),
  tenant_id uuid not null references tenants (id),
  version_hash text not null,
  reviewer_email text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index review_tokens_campaign_idx on review_tokens (campaign_id);

create table pause_switches (
  id uuid primary key default gen_random_uuid(),
  scope pause_scope_t not null,
  scope_value text not null default '*', -- '*' for global
  active boolean not null default true,
  reason text,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (scope, scope_value)
);

create table campaign_metrics (
  campaign_id uuid primary key references campaign_instances (id),
  tenant_id uuid not null references tenants (id),
  recipients int,
  suppressed int,
  delivered int,
  opened int,
  clicked int,
  replied int,
  bounced int,
  unsubscribed int,
  raw jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table ghl_api_usage (
  bucket timestamptz not null, -- truncated to the hour
  ghl_location_id text not null,
  calls int not null default 0,
  errors int not null default 0,
  burst_remaining int,
  daily_remaining int,
  primary key (bucket, ghl_location_id)
);

create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Append-only: see guard_append_only trigger.
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  tenant_id uuid,
  campaign_id uuid,
  edition_id uuid,
  details jsonb not null default '{}'
);
create index audit_log_tenant_idx on audit_log (tenant_id, id desc);
create index audit_log_campaign_idx on audit_log (campaign_id, id desc);

insert into system_settings (key, value) values
  ('ghl_dry_run', 'true'),            -- n8n simulates GHL calls until this is switched off
  ('safe_test_mode', 'true'),         -- every send goes to test contacts only, whatever the tenant says
  ('internal_preview_addresses', '[]'), -- review invites go only here while a tenant is in test mode
  ('ops_alert_email', 'null'),
  ('daily_send_cap', 'null'),         -- max campaigns dispatched per UTC day; null = not configured yet
  ('cost_per_1000_emails_usd', 'null'); -- unset until Archimedes confirms provider cost (spec section 16)
