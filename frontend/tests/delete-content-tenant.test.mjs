// Deleting stories and sub-accounts: unused ones can go; anything approved or sent stays.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { addApprovedEdition, addStory, addTenant, as, createDb, mondayFromNow, one, publish, rows } from './helpers.mjs';

let db;
const users = {};

before(async () => {
  db = await createDb();
  for (const role of ['editor', 'operator']) {
    users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
    await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
  }
});

const run = (role, fn, id) => as(db, 'authenticated', users[role], () => db.query(`select ${fn}($1)`, [id]));
const exists = async (table, id) => (await rows(db, `select 1 from ${table} where id = $1`, [id])).length === 1;
const draftStory = (headline) => one(db, `insert into content_items (division, industry, headline, status) values ('hsg', 'roofing', $1, 'draft') returning *`, [headline]);

test('an editor can delete a draft story, and it is audited', async () => {
  const s = await draftStory('Draft to delete');
  await run('editor', 'content_delete', s.id);
  assert.equal(await exists('content_items', s.id), false);
  const entry = await one(db, `select actor, details from audit_log where action = 'content.deleted' order by id desc limit 1`);
  assert.equal(entry.actor, 'editor@example.com');
  assert.equal(entry.details.headline, 'Draft to delete');
});

// Only approved stories can go into an edition, so this rule also covers every story in use.
test('approved and retired stories stay', async () => {
  const approved = await addStory(db, { headline: 'Approved one' });
  await assert.rejects(run('editor', 'content_delete', approved.id), /Retire it instead/);
  await db.query(`update content_items set status = 'retired' where id = $1`, [approved.id]);
  await assert.rejects(run('editor', 'content_delete', approved.id), /Retire it instead/);
  assert.equal(await exists('content_items', approved.id), true);
});

test('operators cannot delete stories; editors cannot delete sub-accounts', async () => {
  const s = await draftStory('Operator try');
  await assert.rejects(run('operator', 'content_delete', s.id), /does not allow/);
  const t = await addTenant(db);
  await assert.rejects(run('editor', 'tenant_delete', t.id), /does not allow/);
});

test('an operator can delete an unused sub-account with its settings and pauses', async () => {
  const t = await addTenant(db);
  await db.query(`insert into pause_switches (scope, scope_value, active, reason) values ('tenant', $1, true, 'test')`, [t.id]);
  await run('operator', 'tenant_delete', t.id);
  assert.equal(await exists('tenants', t.id), false);
  assert.equal((await rows(db, 'select 1 from brand_profiles where tenant_id = $1', [t.id])).length, 0);
  assert.equal((await rows(db, 'select 1 from newsletter_preferences where tenant_id = $1', [t.id])).length, 0);
  assert.equal((await rows(db, `select 1 from pause_switches where scope_value = $1`, [t.id])).length, 0);
  assert.ok(await one(db, `select 1 from audit_log where action = 'tenant.deleted' and tenant_id = $1`, [t.id]));
});

test('a sub-account with newsletters, or with live sending on, stays', async () => {
  const withCampaigns = await addTenant(db, { industry: 'hvac' });
  await publish(db, await addApprovedEdition(db, { industry: 'hvac', week: mondayFromNow(21) }));
  await assert.rejects(run('operator', 'tenant_delete', withCampaigns.id), /cannot be deleted/);
  const live = await addTenant(db, { industry: 'plumbing' });
  await db.query('update tenants set live_send_enabled = true where id = $1', [live.id]);
  await assert.rejects(run('operator', 'tenant_delete', live.id), /live sending/);
});
