// Problem alerts inside the app: staff see open alerts, admins and operators mark them done,
// and marking done is separate from emailing them.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { as, createDb, one, rows } from './helpers.mjs';

let db;
const users = {};
const open = async () => (await rows(db, 'select id from ops_alerts where resolved_at is null')).length;

before(async () => {
  db = await createDb();
  for (const role of ['operator', 'editor']) {
    users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
    await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
  }
  await db.query(`select raise_alert('dispatch_failed', 'First problem', 'critical')`);
  await db.query(`select raise_alert('render_failed', 'Second problem', 'warning')`);
  await db.query(`select raise_alert('revision_requested', 'Third problem', 'info')`);
});

test('new alerts are open, and staff can read them', async () => {
  assert.equal(await open(), 3);
  const seen = await as(db, 'authenticated', users.editor, async () => (await db.query('select id from ops_alerts where resolved_at is null')).rows.length);
  assert.equal(seen, 3);
});

test('editors cannot mark alerts done', async () => {
  await assert.rejects(as(db, 'authenticated', users.editor, () => db.query('select resolve_ops_alerts(null)')), /does not allow/);
});

test('an operator marks one done, and who did it is kept', async () => {
  const first = await one(db, `select id from ops_alerts where message = 'First problem'`);
  const n = await as(db, 'authenticated', users.operator, async () => (await one(db, 'select resolve_ops_alerts($1) as n', [first.id])).n);
  assert.equal(n, 1);
  assert.equal(await open(), 2);
  assert.equal((await one(db, 'select resolved_by from ops_alerts where id = $1', [first.id])).resolved_by, 'operator@example.com');
});

test('mark all done closes the rest, without touching whether they were emailed', async () => {
  const n = await as(db, 'authenticated', users.operator, async () => (await one(db, 'select resolve_ops_alerts(null) as n')).n);
  assert.equal(n, 2);
  assert.equal(await open(), 0);
  assert.equal((await rows(db, 'select 1 from ops_alerts where claimed_at is not null')).length, 0);
});

test('the media upload setup is skipped where Supabase Storage does not exist', async () => {
  assert.equal((await rows(db, `select 1 from pg_namespace where nspname = 'storage'`)).length, 0);
});
