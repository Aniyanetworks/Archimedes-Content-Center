// Deleting editions: drafts can go; anything approved stays.
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

const del = (role, id) => as(db, 'authenticated', users[role], () => db.query('select edition_delete($1)', [id]));

async function draft(week, status = 'draft') {
  const e = await one(db, `insert into editions (division, industry, publication_week, subject, status) values ('hsg', 'roofing', $1, 'Test', $2) returning *`, [mondayFromNow(week), status]);
  const story = await addStory(db, { headline: 'Draft hero' });
  await db.query(`insert into edition_items (edition_id, content_item_id, slot) values ($1, $2, 'hero')`, [e.id, story.id]);
  return e;
}

test('an editor can delete a draft; its stories stay and the deletion is audited', async () => {
  const e = await draft(10);
  await del('editor', e.id);
  assert.equal((await rows(db, 'select 1 from editions where id = $1', [e.id])).length, 0);
  assert.equal((await rows(db, 'select 1 from edition_items where edition_id = $1', [e.id])).length, 0);
  assert.equal((await rows(db, `select 1 from content_items where headline = 'Draft hero'`)).length, 1);
  const entry = await one(db, `select actor, details from audit_log where action = 'edition.deleted' and edition_id = $1`, [e.id]);
  assert.equal(entry.actor, 'editor@example.com');
  assert.equal(entry.details.subject, 'Test');
});

test('rejected and pending editions can be deleted too', async () => {
  for (const [week, status] of [[11, 'rejected'], [12, 'pending_approval']]) {
    const e = await draft(week, status);
    await del('editor', e.id);
    assert.equal((await rows(db, 'select 1 from editions where id = $1', [e.id])).length, 0);
  }
});

test('an approved edition with campaigns cannot be deleted', async () => {
  await addTenant(db);
  const e = await addApprovedEdition(db, { week: mondayFromNow(13) });
  await publish(db, e);
  await assert.rejects(del('editor', e.id), /cannot be deleted/);
  assert.equal((await rows(db, 'select 1 from editions where id = $1', [e.id])).length, 1);
});

test('operators cannot delete editions', async () => {
  const e = await draft(14);
  await assert.rejects(del('operator', e.id), /does not allow/);
});
