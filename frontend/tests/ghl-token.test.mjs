// Each sub-account's GoHighLevel token: saved from the app into Vault only, counted on the go-live checklist,
// tested by the ghl-check function. And the email workflows' readiness check.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { explain, handleGhlCheck } from '../supabase/functions/_shared/ghlcheck.ts';
import { addTenant, as, createDb, one, rows } from './helpers.mjs';

describe('sub-account token SQL', () => {
  let db;
  const users = {};
  let t;
  before(async () => {
    db = await createDb();
    for (const role of ['operator', 'editor']) {
      users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
      await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
    }
    t = await addTenant(db);
  });
  const save = (role, token) => as(db, 'authenticated', users[role], () => db.query('select set_tenant_ghl_token($1, $2)', [t.id, token]));
  const checklistItem = async () => (await one(db, 'select go_live_checklist($1) as c', [t.id])).c.find((i) => i.item === 'ghl_connected');

  test('starts not connected, and the checklist says so', async () => {
    assert.equal((await checklistItem()).passed, false);
  });

  test('editors cannot save tokens; junk is refused', async () => {
    await assert.rejects(save('editor', 'pit-0123456789abcdefghij'), /does not allow/);
    await assert.rejects(save('operator', '   '), /Paste the GoHighLevel/);
    await assert.rejects(save('operator', 'short'), /does not look like/);
  });

  test('an operator saves it: stored only in Vault under a fixed name, checklist passes, audit has no token', async () => {
    await save('operator', 'pit-0123456789abcdefghij');
    const tenant = await one(db, 'select ghl_token_secret, ghl_token_saved_at from tenants where id = $1', [t.id]);
    assert.equal(tenant.ghl_token_secret, `ghl_tenant_${t.id}`);
    assert.ok(tenant.ghl_token_saved_at);
    assert.equal((await one(db, 'select decrypted_secret from vault.decrypted_secrets where name = $1', [tenant.ghl_token_secret])).decrypted_secret, 'pit-0123456789abcdefghij');
    assert.equal((await checklistItem()).passed, true);
    const entry = await one(db, `select actor, details from audit_log where action = 'tenant.ghl_token_saved' order by id desc limit 1`);
    assert.equal(entry.actor, 'operator@example.com');
    assert.equal(JSON.stringify(entry.details).includes('pit-'), false);
  });

  test('replacing it updates the same secret, and the location ID can change without losing it', async () => {
    await save('operator', 'pit-NEW456789abcdefghijk');
    assert.equal((await rows(db, `select 1 from vault.secrets where name like 'ghl_tenant_%'`)).length, 1);
    await db.query(`update tenants set ghl_location_id = 'newlocation123456789' where id = $1`, [t.id]);
    assert.equal((await one(db, 'select tenant_ghl_check_target($1) as x', [t.id])).x.token, 'pit-NEW456789abcdefghijk');
    assert.equal((await checklistItem()).passed, true);
  });

  test('a token saved the older way (ghl_<location>) is reused, and dispatch finds the new one', async () => {
    const old = await addTenant(db);
    await db.query(`select vault.create_secret('pit-OLDolderolderolder01', 'ghl_' || $1)`, [old.ghl_location_id]);
    await as(db, 'authenticated', users.operator, () => db.query('select set_tenant_ghl_token($1, $2)', [old.id, 'pit-replacedreplaced0001']));
    assert.equal((await one(db, 'select ghl_token_secret from tenants where id = $1', [old.id])).ghl_token_secret, `ghl_${old.ghl_location_id}`);
    assert.equal((await one(db, 'select get_ghl_token($1) as x', [old.ghl_location_id])).x.token, 'pit-replacedreplaced0001');
  });

  test('nobody signed in can read a token', async () => {
    await assert.rejects(as(db, 'authenticated', users.operator, () => db.query('select tenant_ghl_check_target($1)', [t.id])), /permission denied/);
  });

  test('email readiness: not ready without a sender, ready once sender and method are set', async () => {
    let s = (await one(db, 'select notification_sender() as s')).s;
    assert.deepEqual([s.ready, /Sender email/.test(s.problem)], [false, true]);
    await db.query(`update system_settings set value = '"news@example.com"' where key = 'notification_from_email'`);
    await db.query(`update system_settings set value = '{"location_id":"abc","token_saved":true}' where key = 'notification_ghl'`);
    s = (await one(db, 'select notification_sender() as s')).s;
    assert.deepEqual([s.ready, s.problem, s.from], [true, null, 'Archimedes <news@example.com>']);
  });
});

describe('ghl-check function', () => {
  const TENANT = '11111111-2222-3333-4444-555555555555';
  function deps(overrides = {}) {
    const calls = [];
    return {
      calls,
      portalUrl: 'https://portal.example.com',
      extraOrigins: [],
      callerRole: async () => 'operator',
      target: async () => ({ location_id: 'loc1', token: 'pit-1' }),
      probe: async (loc, token) => { calls.push(['probe', loc, token]); return { status: 200, message: '' }; },
      log: async (_a, id, ok) => calls.push(['log', id, ok]),
      ...overrides,
    };
  }
  const post = (body, auth = 'Bearer jwt') => new Request('https://fn.example.com/ghl-check', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body),
  });

  test('a working token reports connected, and the check is logged', async () => {
    const d = deps();
    const result = await (await handleGhlCheck(post({ tenant_id: TENANT }), d)).json();
    assert.equal(result.ok, true);
    assert.deepEqual(d.calls, [['probe', 'loc1', 'pit-1'], ['log', TENANT, true]]);
    assert.equal(JSON.stringify(result).includes('pit-1'), false);
  });

  test('GoHighLevel answers become plain advice', () => {
    assert.match(explain(401, '').message, /did not accept the token/);
    assert.match(explain(403, '').message, /missing permissions or belongs to a different location/);
    assert.match(explain(404, '').message, /could not find this location/);
    assert.match(explain(500, 'boom').message, /\(500\): boom/);
  });

  test('missing token or location is explained without calling GoHighLevel', async () => {
    const noToken = deps({ target: async () => ({ location_id: 'loc1', token: null }) });
    assert.match((await (await handleGhlCheck(post({ tenant_id: TENANT }), noToken)).json()).message, /No token is saved yet/);
    assert.equal(noToken.calls.length, 0);
  });

  test('only admins and operators, signed in', async () => {
    assert.equal((await handleGhlCheck(post({ tenant_id: TENANT }), deps({ callerRole: async () => 'editor' }))).status, 403);
    assert.equal((await handleGhlCheck(post({ tenant_id: TENANT }, ''), deps())).status, 401);
    assert.equal((await handleGhlCheck(post({ tenant_id: 'nope' }), deps())).status, 400);
  });
});
