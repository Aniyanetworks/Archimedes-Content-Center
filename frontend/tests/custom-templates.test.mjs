// Custom templates made with the HTML editor: admin only, the legal footer is required, every save is a new
// immutable version, plans are chosen per template, and removing hides it without losing history.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { addTenant, as, createDb, one, rows } from './helpers.mjs';

let db;
const users = {};
const HTML = '<html><body><h1>[[newsletter_name]]</h1>[[hero_body_html]]<p data-slot="legal">[[legal_business_name]] [[postal_address]]</p>[[unsubscribe_html]]</body></html>';
const LABELS = JSON.stringify({ hsg: { hero_kicker: 'HELLO' }, hospitality: { hero_kicker: 'CHEERS' } });

before(async () => {
  db = await createDb();
  for (const role of ['admin', 'editor']) {
    users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
    await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
  }
});

const save = (role, key, name, html = HTML, plans = ['hsg_growth']) =>
  as(db, 'authenticated', users[role], async () => (await db.query('select save_custom_template($1, $2, $3, $4, $5) as k', [key, name, html, LABELS, plans])).rows[0].k);
const remove = (role, key) => as(db, 'authenticated', users[role], () => db.query('select remove_custom_template($1)', [key]));

let key;

test('an admin creates a template: version 1, current, on the chosen plans, audited', async () => {
  key = await save('admin', null, 'Winter Spotlight');
  assert.match(key, /^custom_winter_spotlight/);
  const m = await one(db, 'select * from master_templates where key = $1', [key]);
  assert.equal(m.is_custom, true);
  const v = await one(db, 'select version, is_current, compiled_html, labels from template_versions where template_key = $1', [key]);
  assert.deepEqual([v.version, v.is_current, v.compiled_html, v.labels.hsg.hero_kicker], [1, true, HTML, 'HELLO']);
  assert.deepEqual((await rows(db, 'select plan_key from plan_templates where template_key = $1', [key])).map((r) => r.plan_key), ['hsg_growth']);
  assert.equal((await one(db, `select actor from audit_log where action = 'templates.created'`)).actor, 'admin@example.com');
});

test('the same name gets its own key', async () => {
  const second = await save('admin', null, 'Winter Spotlight');
  assert.notEqual(second, key);
});

test('the legal footer and unsubscribe link are required', async () => {
  await assert.rejects(save('admin', null, 'Bad', '<p>[[legal_business_name]] [[postal_address]]</p>'), /unsubscribe link.*legal footer/);
  await assert.rejects(save('admin', null, 'Bad', '<p data-slot="legal">[[unsubscribe_html]]</p>'), /business name.*postal address/);
  await assert.rejects(save('admin', null, '  ', HTML), /Give the template a name/);
});

test('saving again publishes version 2 and keeps version 1 unchanged', async () => {
  await save('admin', key, 'Winter Spotlight v2', HTML.replace('<h1>', '<h1 style="color:red">'), ['hsg_growth', 'hsg_freedom']);
  const versions = await rows(db, 'select version, is_current, compiled_html from template_versions where template_key = $1 order by version', [key]);
  assert.deepEqual(versions.map((v) => [v.version, v.is_current]), [[1, false], [2, true]]);
  assert.equal(versions[0].compiled_html, HTML);
  assert.equal((await one(db, 'select name from master_templates where key = $1', [key])).name, 'Winter Spotlight v2');
  assert.equal((await rows(db, 'select 1 from plan_templates where template_key = $1', [key])).length, 2);
});

test('built-in designs cannot be edited or removed, and editors cannot do either', async () => {
  await assert.rejects(save('admin', 'protection_report', 'Hack'), /built-in designs cannot be edited/);
  await assert.rejects(remove('admin', 'protection_report'), /built-in designs cannot be removed/);
  await assert.rejects(save('editor', null, 'Editor try'), /does not allow/);
  await assert.rejects(remove('editor', key), /does not allow/);
});

test('a sub-account on an included plan can use it; removing is blocked while it does', async () => {
  const t = await addTenant(db, { plan: 'hsg_growth', template: key });
  assert.equal((await one(db, 'select tenant_ineligible_reason($1, null) as r', [t.id])).r, null);
  await assert.rejects(remove('admin', key), /1 sub-account\(s\) use this template/);
  await db.query(`update newsletter_preferences set template_key = 'protection_report' where tenant_id = $1`, [t.id]);
});

test('removing hides it from every plan but keeps its versions', async () => {
  await remove('admin', key);
  assert.equal((await one(db, 'select archived from master_templates where key = $1', [key])).archived, true);
  assert.equal((await rows(db, 'select 1 from plan_templates where template_key = $1', [key])).length, 0);
  assert.equal((await rows(db, 'select 1 from template_versions where template_key = $1', [key])).length, 2);
  await assert.rejects(save('admin', key, 'Back again'), /was removed/);
});
