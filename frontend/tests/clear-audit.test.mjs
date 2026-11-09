// Clearing the audit log: admins only, test mode only, typed confirmation, and it leaves one record behind.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { as, createDb, one } from './helpers.mjs';

let db;
const users = {};
const count = async () => Number((await one(db, 'select count(*) as n from audit_log')).n);
const clear = (role, word) => as(db, 'authenticated', users[role], () => db.query('select clear_audit_log($1) as r', [word]));

before(async () => {
  db = await createDb();
  for (const role of ['admin', 'operator']) {
    users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
    await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
  }
  for (let i = 0; i < 3; i++) await db.query(`insert into audit_log (actor, action) values ('someone', 'test.entry')`);
});

test('the system starts in test mode with entries in the log', async () => {
  assert.equal((await one(db, `select value from system_settings where key = 'environment'`)).value, 'test');
  assert.ok((await count()) >= 3);
});

test('non-admins cannot clear it', async () => {
  const before = await count();
  await assert.rejects(clear('operator', 'CLEAR'), /role does not allow/);
  assert.equal(await count(), before);
});

test('the typed word must be CLEAR', async () => {
  const before = await count();
  await assert.rejects(clear('admin', 'clear'), /Type CLEAR/);
  assert.equal(await count(), before);
});

test('an admin clears it and one entry records who did it and how many went', async () => {
  const before = await count();
  const result = (await clear('admin', 'CLEAR')).rows[0].r;
  assert.equal(result.removed, before);
  assert.equal(await count(), 1);
  const entry = await one(db, 'select actor, action, details from audit_log');
  assert.equal(entry.actor, 'admin@example.com');
  assert.equal(entry.action, 'audit.cleared');
  assert.equal(entry.details.entries_removed, before);
});

test('the log is still protected from direct deletes', async () => {
  await assert.rejects(db.query('delete from audit_log where true'), /append-only/);
});

test('once the system is live it can never be cleared', async () => {
  await db.query(`update system_settings set value = '"production"' where key = 'environment'`);
  await assert.rejects(clear('admin', 'CLEAR'), /live system is permanent/);
  assert.equal(await count(), 1);
});
