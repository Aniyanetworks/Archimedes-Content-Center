// Email server (SMTP) settings: admin only, the password never reaches our database, and n8n is driven correctly.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { handleSmtp, validateSmtp } from '../supabase/functions/_shared/smtp.ts';
import { as, createDb, one } from './helpers.mjs';

describe('smtp SQL', () => {
  let db;
  const users = {};
  before(async () => {
    db = await createDb();
    for (const role of ['admin', 'editor']) {
      users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
      await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
    }
  });
  const save = (role, config) => as(db, 'authenticated', users[role], () => db.query('select save_smtp_config($1)', [JSON.stringify(config)]));
  const config = { credential_id: 'abc', host: 'smtp.example.com', port: 465, user: 'news@example.com', secure: true, updated_at: '2026-11-09T00:00:00Z' };

  test('starts empty', async () => {
    assert.equal((await one(db, `select value from system_settings where key = 'smtp_config'`)).value, null);
  });

  test('an admin saves it, and the audit entry has no password', async () => {
    await save('admin', config);
    assert.equal((await one(db, `select value from system_settings where key = 'smtp_config'`)).value.host, 'smtp.example.com');
    const entry = await one(db, `select actor, details from audit_log where action = 'settings.smtp_saved' order by id desc limit 1`);
    assert.equal(entry.actor, 'admin@example.com');
    assert.equal(entry.details.user, 'news@example.com');
    assert.equal(JSON.stringify(entry.details).includes('password'), false);
  });

  test('a password can never be stored', async () => {
    await assert.rejects(save('admin', { ...config, password: 'secret' }), /must not be stored/);
  });

  test('non-admins cannot change it', async () => {
    await assert.rejects(save('editor', config), /does not allow/);
  });
});

describe('smtp-settings function', () => {
  const stored = { credential_id: 'cred-1', host: 'smtp.old.com', port: 587, user: 'old@example.com', secure: false, updated_at: 'x' };
  function deps(overrides = {}) {
    const calls = [];
    let workflowsOn = false;
    return {
      calls,
      portalUrl: 'https://portal.example.com',
      extraOrigins: ['http://localhost:5173'],
      callerRole: async () => 'admin',
      getConfig: async () => null,
      senderEmailSet: async () => true,
      channel: async () => 'smtp',
      ghlReady: async () => false,
      saveConfig: async (_a, c) => calls.push(['saveConfig', c]),
      logEvent: async (_a, action) => calls.push(['log', action]),
      createCredential: async (input) => { calls.push(['create', input]); return 'cred-new'; },
      updateCredential: async (id, input) => { calls.push(['update', id, input]); return true; },
      testCredential: async (id) => { calls.push(['test', id]); return { ok: true, message: 'Connection successful!' }; },
      linkWorkflows: async (id) => calls.push(['link', id]),
      workflowStates: async () => [{ id: 'w4', name: 'Archimedes 04', active: workflowsOn }],
      setWorkflowsActive: async (on) => { workflowsOn = on; calls.push(['active', on]); return [{ id: 'w4', name: 'Archimedes 04', active: on }]; },
      ...overrides,
    };
  }
  const post = (body, headers = {}) => new Request('https://fn.example.com/smtp-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t', Origin: 'https://portal.example.com', ...headers }, body: JSON.stringify(body),
  });
  const form = { action: 'save', host: ' smtp.new.com ', port: 465, user: 'news@new.com', password: 'pw', secure: true };

  test('the form is checked in plain English', () => {
    assert.match(validateSmtp({ ...form, host: '' }).error, /server address/);
    assert.match(validateSmtp({ ...form, port: 0 }).error, /port/);
    assert.match(validateSmtp({ ...form, user: '' }).error, /username/);
    assert.match(validateSmtp({ ...form, password: '' }).error, /password/);
    assert.equal(validateSmtp(form).input.host, 'smtp.new.com');
  });

  test('first save creates the n8n connection, links the workflows, stores no password and tests it', async () => {
    const d = deps();
    const response = await handleSmtp(post(form), d);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.test.ok, true);
    assert.deepEqual(d.calls.map((c) => c[0]), ['create', 'link', 'saveConfig', 'test', 'log']);
    const saved = d.calls.find((c) => c[0] === 'saveConfig')[1];
    assert.equal(saved.credential_id, 'cred-new');
    assert.equal('password' in saved, false);
    assert.equal(JSON.stringify(result).includes('pw'), false);
  });

  test('a later save updates the same connection', async () => {
    const d = deps({ getConfig: async () => stored });
    await handleSmtp(post(form), d);
    assert.deepEqual(d.calls[0].slice(0, 2), ['update', 'cred-1']);
    assert.equal(d.calls.some((c) => c[0] === 'create'), false);
  });

  test('if the connection was deleted in n8n, a new one is made', async () => {
    const d = deps({ getConfig: async () => stored, updateCredential: async () => false });
    await handleSmtp(post(form), d);
    assert.ok(d.calls.some((c) => c[0] === 'create'));
  });

  test('email workflows only turn on once the server and sender email are set', async () => {
    assert.match((await (await handleSmtp(post({ action: 'workflows', on: true }), deps())).json()).error, /Save the email server first/);
    const noSender = deps({ getConfig: async () => stored, senderEmailSet: async () => false });
    assert.match((await (await handleSmtp(post({ action: 'workflows', on: true }), noSender)).json()).error, /Sender email/);
    const ready = deps({ getConfig: async () => stored });
    const result = await (await handleSmtp(post({ action: 'workflows', on: true }), ready)).json();
    assert.equal(result.workflows[0].active, true);
    assert.deepEqual(ready.calls.map((c) => c[0]), ['link', 'active', 'log']);
  });

  test('with GoHighLevel chosen, they turn on once GoHighLevel is set up, even without SMTP', async () => {
    const notReady = deps({ channel: async () => 'ghl' });
    assert.match((await (await handleSmtp(post({ action: 'workflows', on: true }), notReady)).json()).error, /GoHighLevel location and token/);
    const ready = deps({ channel: async () => 'ghl', ghlReady: async () => true });
    const result = await (await handleSmtp(post({ action: 'workflows', on: true }), ready)).json();
    assert.equal(result.workflows[0].active, true);
    assert.equal(ready.calls.some((c) => c[0] === 'link'), false);
  });

  test('turning them off always works', async () => {
    const d = deps();
    const result = await (await handleSmtp(post({ action: 'workflows', on: false }), d)).json();
    assert.equal(result.workflows[0].active, false);
  });

  test('non-admins and signed-out callers are refused', async () => {
    assert.equal((await handleSmtp(post(form), deps({ callerRole: async () => 'operator' }))).status, 403);
    assert.equal((await handleSmtp(post(form, { Authorization: '' }), deps())).status, 401);
  });

  test('an n8n failure comes back as a readable error', async () => {
    const d = deps({ createCredential: async () => { throw new Error('n8n said: bad request'); } });
    const response = await handleSmtp(post(form), d);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /n8n said/);
  });
});
