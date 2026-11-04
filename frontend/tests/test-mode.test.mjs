import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { addApprovedEdition, addTenant, as, call, campaign, createDb, mondayFromNow, one, publish, rows } from './helpers.mjs';

let db;
let admin;
let operator;
const asAdmin = (work) => as(db, 'authenticated', admin, work);
const count = async (table) => (await one(db, `select count(*)::int n from ${table}`)).n;

before(async () => {
  db = await createDb();
  admin = (await one(db, `insert into auth.users (email) values ('admin@example.com') returning id`)).id;
  operator = (await one(db, `insert into auth.users (email) values ('op@example.com') returning id`)).id;
  await db.query(`insert into staff_roles values ($1, 'admin'), ($2, 'operator')`, [admin, operator]);
});

describe('test mode', () => {
  test('a new install starts in test mode', async () => {
    assert.equal((await one(db, `select value from system_settings where key = 'environment'`)).value, 'test');
  });

  test('only admins can load, reset or go live', async () => {
    await as(db, 'authenticated', operator, async () => {
      await assert.rejects(db.query('select seed_test_data()'), /role does not allow/);
      await assert.rejects(db.query(`select reset_test_data('RESET')`), /role does not allow/);
      await assert.rejects(db.query(`select go_live('GO LIVE')`), /role does not allow/);
    });
    await as(db, 'anon', null, () => assert.rejects(db.query(`select reset_test_data('RESET')`), /permission denied/));
  });

  test('sample data covers the three pilots and flows through routing', async () => {
    await asAdmin(() => db.query('select seed_test_data()'));
    assert.equal(await count('tenants'), 4);
    assert.equal(await count('editions'), 3);
    await asAdmin(() => assert.rejects(db.query('select seed_test_data()'), /Reset first/));
    for (const edition of await rows(db, 'select id from editions')) await publish(db, edition);
    const byTenant = Object.fromEntries((await rows(db, 'select t.name, c.status, c.status_reason from campaign_instances c join tenants t on t.id = c.tenant_id')).map((r) => [r.name, r.status]));
    assert.equal(byTenant['Equinox Roofing'], 'CLIENT_REVIEW_PENDING');
    assert.equal(byTenant['Summit Peak Roofing'], 'APPROVED_FOR_SEND');
    assert.equal(byTenant['Timber Ridge HVAC'], 'APPROVED_FOR_SEND');
    assert.equal(byTenant['Craft Mountain Brewery'], 'APPROVED_FOR_SEND');
  });

  test('send now brings approved campaigns into the dispatch window', async () => {
    const result = (await asAdmin(() => db.query('select test_send_now() as r'))).rows[0].r;
    assert.equal(result.approved, 3);
    assert.equal(result.review, 1);
    const claimed = (await call(db, 'claim_campaigns_for_dispatch', [100, 60])).map((r) => r.claim_campaigns_for_dispatch);
    assert.equal(claimed.length, 3);
    for (const row of claimed) assert.deepEqual(row.ghl_schedule_body.recipients, { type: 'contact', contactIds: ['test-contact'] });
    for (const row of claimed) await db.query('select record_dry_run($1)', [row.campaign_id]);
  });

  test('test mode overrides every live setting', async () => {
    const t = await addTenant(db);
    await db.query(`update tenants set live_send_enabled = true, test_mode = false where id = $1`, [t.id]);
    await db.exec(`update system_settings set value = 'false' where key = 'safe_test_mode';`);
    assert.equal((await call(db, 'campaign_audience', [t.id]))[0].campaign_audience.type, 'contact');
    await asAdmin(() => assert.rejects(db.query('select set_live_send($1, true)', [t.id]), /not available in test mode/));
    await asAdmin(() => assert.rejects(db.query(`select set_setting('environment', '"production"')`), /Use Go live/));
  });

  test('the audit log stays protected outside the reset', async () => {
    await assert.rejects(db.query('delete from audit_log'), /append-only/);
    await assert.rejects(db.query('truncate audit_log'), /append-only/);
    await assert.rejects(db.query(`update audit_log set actor = 'x'`), /append-only/);
  });

  test('reset needs the typed confirmation', async () => {
    await asAdmin(() => assert.rejects(db.query(`select reset_test_data('yes')`), /Type RESET/));
    assert.ok((await count('tenants')) > 0);
  });

  test('reset refuses while GHL still holds a real campaign', async () => {
    const c = await one(db, `select id from campaign_instances where status = 'SCHEDULED' limit 1`);
    await db.query(`update campaign_instances set ghl_campaign_id = 'ghl-real' where id = $1`, [c.id]);
    await asAdmin(() => assert.rejects(db.query(`select reset_test_data('RESET')`), /still exist in GHL/));
    await db.query(`update campaign_instances set ghl_campaign_id = 'dry-run-x' where id = $1`, [c.id]);
  });

  test('reset clears test data, keeps staff and templates, and restores safety', async () => {
    await db.exec(`update system_settings set value = 'false' where key = 'ghl_dry_run';`);
    await asAdmin(() => db.query(`select reset_test_data('RESET')`));
    for (const table of ['tenants', 'brand_profiles', 'newsletter_preferences', 'editions', 'content_items', 'campaign_instances', 'approval_events', 'review_tokens', 'ops_alerts', 'pause_switches']) {
      assert.equal(await count(table), 0, table);
    }
    assert.equal(await count('audit_log'), 1, 'only the reset itself remains');
    assert.equal((await one(db, 'select action, actor from audit_log')).actor, 'admin@example.com');
    assert.equal(await count('staff_roles'), 2);
    assert.equal(await count('template_versions'), 5);
    assert.equal(await count('plan_entitlements'), 4);
    assert.equal((await one(db, `select value from system_settings where key = 'ghl_dry_run'`)).value, true);
    assert.equal((await one(db, `select value from system_settings where key = 'safe_test_mode'`)).value, true);
    await assert.rejects(db.query('delete from audit_log'), /append-only/);
  });

  test('test data can be loaded again after a reset', async () => {
    await asAdmin(() => db.query('select seed_test_data()'));
    assert.equal(await count('tenants'), 4);
  });

  test('going live needs test data gone and a typed confirmation', async () => {
    await asAdmin(() => assert.rejects(db.query(`select go_live('yes')`), /Type GO LIVE/));
    await asAdmin(() => assert.rejects(db.query(`select go_live('GO LIVE')`), /Reset the test data/));
    await asAdmin(() => db.query(`select reset_test_data('RESET')`));
    await asAdmin(() => db.query(`select go_live('GO LIVE')`));
    assert.equal((await one(db, `select value from system_settings where key = 'environment'`)).value, 'production');
  });

  test('a live system can never be reset or returned to test mode', async () => {
    await asAdmin(() => assert.rejects(db.query(`select reset_test_data('RESET')`), /live system cannot be reset/));
    await asAdmin(() => assert.rejects(db.query('select seed_test_data()'), /only be loaded in test mode/));
    await asAdmin(() => assert.rejects(db.query('select test_send_now()'), /only available in test mode/));
    await assert.rejects(db.exec(`update system_settings set value = '"test"' where key = 'environment';`), /cannot return to test mode/);
    await db.exec(`select set_config('app.test_reset', 'on', false);`);
    await assert.rejects(db.query('delete from audit_log'), /append-only/);
    await db.exec(`select set_config('app.test_reset', 'off', false);`);
    assert.ok((await count('audit_log')) >= 1);
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(3) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    assert.equal((await campaign(db, c.id)).status, 'APPROVED_FOR_SEND');
  });
});