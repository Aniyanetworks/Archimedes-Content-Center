import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Minimal stand-ins for what Supabase provides: auth, Vault and the three API roles.
const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema vault;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, last_sign_in_at timestamptz, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, decrypted_secret text);
  create view vault.decrypted_secrets as select * from vault.secrets;
  create function vault.create_secret(secret text, name text) returns uuid language sql as $$ insert into vault.secrets (name, decrypted_secret) values (name, secret) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text) returns void language sql as $$ update vault.secrets set decrypted_secret = new_secret where id = secret_id $$;
  grant usage on schema auth, vault, public to anon, authenticated, service_role;
  grant select on auth.users to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(read('supabase/migrations/0001_schema.sql'));
  await db.exec(read('supabase/migrations/0002_engine.sql'));
  await db.exec(read('supabase/migrations/0003_review_config.sql'));
  await db.exec(read('supabase/migrations/0004_test_mode.sql'));
  await db.exec(read('supabase/migrations/0005_delivery_and_settings.sql'));
  await db.exec(read('supabase/migrations/0006_realistic_test_data.sql'));
  await db.exec(read('supabase/migrations/0007_reset_safeupdate.sql'));
  await db.exec(read('supabase/migrations/0008_staff_management.sql'));
  await db.exec(read('supabase/migrations/0009_template_examples.sql'));
  await db.exec(read('supabase/migrations/0010_delete_edition.sql'));
  await db.exec(read('supabase/migrations/0011_delete_content_and_tenant.sql'));
  await db.exec(read('supabase/migrations/0012_default_send_settings.sql'));
  await db.exec(read('supabase/migrations/0013_clear_audit_log.sql'));
  await db.exec(read('supabase/migrations/0014_smtp_settings.sql'));
  await db.exec(read('supabase/migrations/0015_n8n_config_vault.sql'));
  await db.exec(read('supabase/migrations/0016_notification_channel.sql'));
  await db.exec(read('supabase/migrations/0017_ghl_default_channel.sql'));
  await db.exec(read('supabase/migrations/0018_custom_templates.sql'));
  await db.exec(read('supabase/seed/reference.sql'));
  await db.exec(read('supabase/seed/templates.sql'));
  return db;
}

export async function as(db, role, userId, work) {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${userId ?? ''}', false);`);
  try {
    return await work();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.sub', '', false); select set_config('app.actor', '', false);`);
  }
}

export const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
export const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
export const call = async (db, fn, args = []) => {
  const list = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await db.query(`select * from ${fn}(${list})`, args)).rows;
};

export function mondayFromNow(weeks) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + weeks * 7);
  return date.toISOString().slice(0, 10);
}

let counter = 0;

export async function addTenant(db, options = {}) {
  counter += 1;
  const o = {
    name: `Tenant ${counter}`, division: 'hsg', industry: 'roofing', plan: 'hsg_growth', template: 'protection_report', cadence: 'weekly', review: 'auto', areas: ['US-CO'],
    verified: true, reviewer: 'reviewer@example.com', ...options,
  };
  const t = await one(db, `insert into tenants (ghl_location_id, name, division, industry, plan_key, service_areas, opted_in, compliance_acknowledged_at, biweekly_offset, stagger_minutes)
    values ($1, $2, $3, $4, $5, $6, true, now(), $7, 0) returning *`, [`loc-${counter}`, o.name, o.division, o.industry, o.plan, o.areas, o.offset ?? 0]);
  await db.query(`insert into brand_profiles (tenant_id, newsletter_name, legal_business_name, postal_address, from_name, from_email, sender_verified, domain_authenticated, phone, website, booking_url)
    values ($1, $2, $3, '100 Example St, Denver, CO', $2, $4, $5, true, $6, 'https://example.com', 'https://example.com/book')`,
  [t.id, `${o.name} News`, `${o.name} LLC`, `news${counter}@example.com`, o.verified, `555-010-${String(counter).padStart(4, '0')}`]);
  await db.query(`insert into newsletter_preferences (tenant_id, template_key, cadence, review_mode, reviewer_email, allowed_segments, test_contact_ids, ghl_user_id, approval_deadline_hours)
    values ($1, $2, $3, $4, $5, '{tag-1}', '{contact-1}', 'user-1', 24)`, [t.id, o.template, o.cadence, o.review, o.review === 'review' ? o.reviewer : null]);
  return t;
}

export async function addStory(db, options = {}) {
  const o = { division: 'hsg', industry: 'roofing', headline: 'Story', regions: [], ...options };
  return one(db, `insert into content_items (division, industry, regions, headline, teaser, body, status) values ($1, $2, $3, $4, 'Teaser', 'Body text', 'approved') returning *`,
    [o.division, o.industry, o.regions, o.headline]);
}

export async function addApprovedEdition(db, options = {}) {
  const o = { division: 'hsg', industry: 'roofing', week: mondayFromNow(2), ...options };
  const hero = o.hero ?? (await addStory(db, { division: o.division, industry: o.industry, headline: 'Hero story' }));
  const edition = await one(db, `insert into editions (division, industry, publication_week, subject, status, central_approved_at, version)
    values ($1, $2, $3, 'Subject', 'approved', now(), 1) returning *`, [o.division, o.industry, o.week]);
  await db.query(`insert into edition_items (edition_id, content_item_id, slot, position) values ($1, $2, 'hero', 0)`, [edition.id, hero.id]);
  for (const [index, story] of (o.secondary ?? []).entries()) {
    await db.query(`insert into edition_items (edition_id, content_item_id, slot, position) values ($1, $2, 'secondary', $3)`, [edition.id, story.id, index + 1]);
  }
  return edition;
}

export const SAMPLE_HTML = '<html><span data-slot="legal">Legal</span><a data-slot="unsubscribe" href="#">Unsubscribe</a></html>';

// Queues an edition and renders every campaign it created, returning them by tenant.
export async function publish(db, edition, html = SAMPLE_HTML) {
  await call(db, 'queue_edition_campaigns', [edition.id]);
  for (const row of await call(db, 'claim_campaigns_for_render', [100])) {
    const bundle = row.claim_campaigns_for_render;
    await call(db, 'record_render', [bundle.campaign_id, `${html}<!-- ${bundle.campaign_id} -->`, 'text', 'Subject']);
  }
  return rows(db, 'select * from campaign_instances where edition_id = $1', [edition.id]);
}

export const campaign = (db, id) => one(db, 'select * from campaign_instances where id = $1', [id]);
