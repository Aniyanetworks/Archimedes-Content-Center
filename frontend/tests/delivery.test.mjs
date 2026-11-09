import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { addApprovedEdition, addTenant, call, campaign, createDb, mondayFromNow, one, publish } from './helpers.mjs';

let db;
let week = 2;

// A real (non dry-run) campaign that GHL reported as sent, sent_at minutes ago.
async function sentCampaign(minutesAgo = 60) {
  const t = await addTenant(db);
  const edition = await addApprovedEdition(db, { week: mondayFromNow(week++) });
  const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
  await db.query(`update campaign_instances set ghl_campaign_id = 'ghl-' || id, ghl_draft_hash = rendered_html_hash, dispatch_state = 'done', status = 'SCHEDULED' where id = $1`, [c.id]);
  await db.query(`update campaign_instances set status = 'SENT', sent_at = now() - make_interval(mins => $2) where id = $1`, [c.id, minutesAgo]);
  return c;
}
const listed = async () => (await call(db, 'list_campaigns_to_check_delivery', [100])).map((r) => r.list_campaigns_to_check_delivery.campaign_id);
const check = (id, ...args) => db.query('select record_delivery_check($1, $2, $3, $4, $5, $6) as r', [id, ...args]).then((r) => r.rows[0].r);

before(async () => {
  db = await createDb();
  await db.exec(`update system_settings set value = '"production"' where key = 'environment'; update system_settings set value = 'false' where key = 'safe_test_mode';`);
});

describe('delivery check', () => {
  test('waits the configured time before checking a sent campaign', async () => {
    const fresh = await sentCampaign(5);
    assert.ok(!(await listed()).includes(fresh.id));
    await db.exec(`update system_settings set value = '2' where key = 'delivery_check_after_minutes';`);
    assert.ok((await listed()).includes(fresh.id), 'the setting, not code, decides the wait');
    await db.exec(`update system_settings set value = '30' where key = 'delivery_check_after_minutes';`);
  });

  test('a campaign GHL "sent" but delivered to nobody is flagged as failed, with an alert', async () => {
    const c = await sentCampaign();
    assert.ok((await listed()).includes(c.id));
    assert.equal((await check(c.id, true, true, 1, 0, 0)).state, 'failed');
    const after = await campaign(db, c.id);
    assert.equal(after.delivery_state, 'failed');
    assert.equal(after.status, 'SENT');
    assert.equal(after.status_reason, 'delivery_failed: 0 of 1 delivered');
    assert.ok(await one(db, `select 1 from ops_alerts where kind = 'delivery_failed' and campaign_id = $1 and severity = 'critical'`, [c.id]));
    assert.equal((await one(db, 'select recipients, delivered from campaign_metrics where campaign_id = $1', [c.id])).delivered, 0);
    assert.ok(!(await listed()).includes(c.id), 'a final result is not checked again');
  });

  test('a fully delivered campaign is recorded and no alert is raised', async () => {
    const c = await sentCampaign();
    assert.equal((await check(c.id, true, true, 40, 40, 0)).state, 'delivered');
    assert.equal((await campaign(db, c.id)).status_reason, null);
    assert.equal(await one(db, 'select count(*)::int n from ops_alerts where campaign_id = $1', [c.id]).then((r) => r.n), 0);
  });

  test('queued emails are re-checked instead of judged early', async () => {
    const c = await sentCampaign();
    assert.equal((await check(c.id, true, true, 40, 10, 30)).state, 'waiting');
    assert.equal((await campaign(db, c.id)).delivery_state, 'unchecked');
    assert.ok((await listed()).includes(c.id));
  });

  test('a partial delivery is re-checked, and only alerts once the window has passed', async () => {
    const c = await sentCampaign();
    assert.equal((await check(c.id, true, true, 40, 30, 0)).state, 'partial');
    assert.ok((await listed()).includes(c.id));
    assert.equal(await one(db, `select count(*)::int n from ops_alerts where kind = 'delivery_partial' and campaign_id = $1`, [c.id]).then((r) => r.n), 0);
    await db.query(`update campaign_instances set sent_at = now() - interval '25 hours' where id = $1`, [c.id]);
    await check(c.id, true, true, 40, 30, 0);
    assert.ok(await one(db, `select 1 from ops_alerts where kind = 'delivery_partial' and campaign_id = $1`, [c.id]));
    assert.ok(!(await listed()).includes(c.id));
  });

  test('GHL being unreachable changes nothing', async () => {
    const c = await sentCampaign();
    assert.equal((await check(c.id, false, null, null, null, null)).reason, 'unreachable');
    assert.equal((await campaign(db, c.id)).delivery_state, 'unchecked');
  });

  test('no numbers from GHL waits first, then becomes unverified with an alert', async () => {
    const c = await sentCampaign();
    assert.equal((await check(c.id, true, false, null, null, null)).state, 'waiting');
    await db.query(`update campaign_instances set sent_at = now() - interval '25 hours' where id = $1`, [c.id]);
    assert.equal((await check(c.id, true, false, null, null, null)).state, 'unverified');
    assert.ok(await one(db, `select 1 from ops_alerts where kind = 'delivery_unverified' and campaign_id = $1`, [c.id]));
  });

  test('dry runs are never checked against GHL', async () => {
    const c = await sentCampaign();
    await db.query(`update campaign_instances set ghl_campaign_id = 'dry-run-x' where id = $1`, [c.id]);
    assert.ok(!(await listed()).includes(c.id));
  });

  test('the dashboard view carries the delivery state', async () => {
    const c = await sentCampaign();
    await check(c.id, true, true, 1, 0, 0);
    assert.equal((await one(db, 'select delivery_state from campaign_overview where id = $1', [c.id])).delivery_state, 'failed');
  });
});

describe('notification sender', () => {
  test('email workflows stop with a clear message until the sender is set', async () => {
    // This test is about the sender address, so it uses the SMTP method (GoHighLevel also needs a location).
    await db.exec(`update system_settings set value = '"smtp"' where key = 'notification_channel';`);
    await assert.rejects(db.query('select notification_sender()'), /Set the notification sender/);
    await db.exec(`update system_settings set value = '"ops@example.com"' where key = 'notification_from_email';`);
    const s = (await one(db, 'select notification_sender() as s')).s;
    assert.equal(s.from, 'Archimedes <ops@example.com>');
    await db.exec(`update system_settings set value = '"Archimedes Ops"' where key = 'notification_from_name';`);
    assert.equal((await one(db, 'select notification_sender() as s')).s.from, 'Archimedes Ops <ops@example.com>');
  });

  test('only the service role can call the new functions', async () => {
    await db.exec('set role anon');
    try {
      for (const fn of ['notification_sender()', 'list_campaigns_to_check_delivery(1)']) await assert.rejects(db.query(`select ${fn}`), /permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });
});
