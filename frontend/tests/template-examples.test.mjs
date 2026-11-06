// Editable example content for the template previews.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { as, createDb, one } from './helpers.mjs';

let db;
const users = {};

before(async () => {
  db = await createDb();
  for (const role of ['admin', 'editor', 'operator']) {
    users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
    await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
  }
});

const example = { subject: 'Hello', preview_text: 'Hi', hero: { headline: 'Main story', teaser: 'Short' }, secondary: [], offer: {}, brand: { newsletter_name: 'Test News' } };
const setAs = (role, division, value) => as(db, 'authenticated', users[role], () => db.query('select set_template_sample($1, $2)', [division, value === null ? null : JSON.stringify(value)]));
const stored = async (division) => (await one(db, `select value from system_settings where key = $1`, [`template_sample_${division}`])).value;

test('starts empty, so previews use the built-in example', async () => {
  assert.equal(await stored('hsg'), null);
  assert.equal(await stored('hospitality'), null);
});

test('admins and editors can save example content; it is audited', async () => {
  await setAs('editor', 'hsg', example);
  assert.equal((await stored('hsg')).hero.headline, 'Main story');
  await setAs('admin', 'hospitality', example);
  const entry = await one(db, `select actor, action, details from audit_log where action = 'templates.example_changed' order by id desc limit 1`);
  assert.equal(entry.actor, 'admin@example.com');
  assert.equal(entry.details.division, 'hospitality');
});

test('operators cannot change it', async () => {
  await assert.rejects(setAs('operator', 'hsg', example), /does not allow/);
});

test('a main story headline is required', async () => {
  await assert.rejects(setAs('admin', 'hsg', { ...example, hero: { headline: '' } }), /needs a headline/);
});

test('reset goes back to the built-in example', async () => {
  await setAs('admin', 'hsg', null);
  assert.equal(await stored('hsg'), null);
  assert.ok(await one(db, `select 1 from audit_log where action = 'templates.example_reset'`));
});
