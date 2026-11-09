// Notification emails by SMTP or GoHighLevel: admin only, the GHL token stays in Vault, and the sender says which way to send.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { handleNotify } from '../supabase/functions/_shared/notify.ts';
import { as, createDb, one } from './helpers.mjs';

describe('notification channel SQL', () => {
  let db;
  const users = {};
  before(async () => {
    db = await createDb();
    for (const role of ['admin', 'operator']) {
      users[role] = (await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`])).id;
      await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [users[role], role]);
    }
    await db.query(`update system_settings set value = '"news@example.com"' where key = 'notification_from_email'`);
  });
  const asRole = (role, sql, params) => as(db, 'authenticated', users[role], () => db.query(sql, params));
  const setting = async (key) => (await one(db, 'select value from system_settings where key = $1', [key])).value;

  test('GoHighLevel is the default; email workflows wait until its location is saved', async () => {
    assert.equal(await setting('notification_channel'), 'ghl');
    await assert.rejects(db.query('select notification_sender()'), /no GoHighLevel location is saved/);
    const entry = await one(db, `select details from audit_log where action = 'settings.notification_channel' order by id desc limit 1`);
    assert.equal(entry.details.reason, 'default value');
  });

  test('GoHighLevel cannot be chosen again by hand before it is set up', async () => {
    await assert.rejects(asRole('admin', `select set_notification_channel('ghl')`), /location and token first/);
  });

  test('the first save needs a token, and the location ID is checked', async () => {
    await assert.rejects(asRole('admin', `select set_notification_ghl('abcDEF1234567890xyz', null)`), /Paste the GoHighLevel/);
    await assert.rejects(asRole('admin', `select set_notification_ghl('not a location', 'pit-1')`), /location ID/);
  });

  test('saving keeps the token only in Vault, and the audit entry has no token', async () => {
    await asRole('admin', `select set_notification_ghl('abcDEF1234567890xyz', 'pit-secret-1')`);
    const saved = await setting('notification_ghl');
    assert.equal(saved.location_id, 'abcDEF1234567890xyz');
    assert.equal(JSON.stringify(saved).includes('pit-secret'), false);
    assert.equal((await one(db, `select decrypted_secret from vault.decrypted_secrets where name = 'ghl_notify_token'`)).decrypted_secret, 'pit-secret-1');
    const entry = await one(db, `select details from audit_log where action = 'settings.notification_ghl' order by id desc limit 1`);
    assert.equal(JSON.stringify(entry.details).includes('pit-secret'), false);
  });

  test('saving again without a token keeps the old one; with a token replaces it', async () => {
    await asRole('admin', `select set_notification_ghl('abcDEF1234567890xyz', null)`);
    assert.equal((await one(db, `select decrypted_secret from vault.decrypted_secrets where name = 'ghl_notify_token'`)).decrypted_secret, 'pit-secret-1');
    await asRole('admin', `select set_notification_ghl('abcDEF1234567890xyz', 'pit-secret-2')`);
    assert.equal((await one(db, `select count(*)::int as n from vault.secrets where name = 'ghl_notify_token'`)).n, 1);
    assert.equal((await one(db, 'select notification_ghl_config() as c')).c.token, 'pit-secret-2');
  });

  test('an admin switches to GoHighLevel and back; the sender follows', async () => {
    await asRole('admin', `select set_notification_channel('ghl')`);
    assert.equal((await one(db, 'select notification_sender() as s')).s.channel, 'ghl');
    await asRole('admin', `select set_notification_channel('smtp')`);
    assert.equal((await one(db, 'select notification_sender() as s')).s.channel, 'smtp');
    await assert.rejects(asRole('admin', `select set_notification_channel('fax')`), /Choose SMTP or GoHighLevel/);
  });

  test('non-admins cannot change anything, and nobody signed in can read the token', async () => {
    await assert.rejects(asRole('operator', `select set_notification_channel('smtp')`), /does not allow/);
    await assert.rejects(asRole('operator', `select set_notification_ghl('abcDEF1234567890xyz', 'x')`), /does not allow/);
    await assert.rejects(asRole('admin', 'select notification_ghl_config()'), /permission denied/);
  });
});

describe('notify-ghl function', () => {
  const SERVICE = 'service-key';
  function deps(overrides = {}) {
    const calls = [];
    return {
      calls,
      portalUrl: 'https://portal.example.com',
      extraOrigins: [],
      serviceKey: SERVICE,
      getConfig: async () => ({ location_id: 'loc1', token: 'pit-1', from_email: 'news@example.com', from_name: 'Archimedes' }),
      caller: async () => ({ role: 'admin', email: 'Admin@Example.com' }),
      upsertContact: async (_c, email, name) => { calls.push(['contact', email, name]); return 'contact-1'; },
      sendEmail: async (_c, contactId, email) => { calls.push(['send', contactId, email]); return 'msg-1'; },
      logTest: async (_a, ok, to) => calls.push(['log', ok, to]),
      ...overrides,
    };
  }
  const post = (body, key = SERVICE) => new Request('https://fn.example.com/notify-ghl', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  });

  test('n8n sends an email: contact first, then the message, from the configured sender', async () => {
    const d = deps();
    const response = await handleNotify(post({ to: 'Reviewer@Client.com', subject: 'Review needed', html: '<p>Hi</p>' }), d);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, to: 'reviewer@client.com', messageId: 'msg-1' });
    assert.deepEqual(d.calls[0], ['contact', 'reviewer@client.com', undefined]);
    assert.deepEqual(d.calls[1], ['send', 'contact-1', { subject: 'Review needed', html: '<p>Hi</p>', from: 'Archimedes <news@example.com>' }]);
  });

  test('n8n requests are checked', async () => {
    assert.equal((await handleNotify(post({ to: 'bad', subject: 's', html: 'h' }), deps())).status, 400);
    assert.equal((await handleNotify(post({ to: 'a@b.co', subject: '', html: 'h' }), deps())).status, 400);
  });

  test('an admin test goes only to their own address, with fixed content, and is logged', async () => {
    const d = deps();
    const result = await (await handleNotify(post({ action: 'test', to: 'someone@else.com', subject: 'x', html: 'x' }, 'user-jwt'), d)).json();
    assert.equal(result.to, 'admin@example.com');
    assert.equal(d.calls[0][1], 'admin@example.com');
    assert.match(d.calls[1][2].subject, /test email/);
    assert.deepEqual(d.calls[2], ['log', true, 'admin@example.com']);
  });

  test('non-admins cannot send, and arbitrary emails need the service key', async () => {
    assert.equal((await handleNotify(post({ action: 'test' }, 'jwt'), deps({ caller: async () => ({ role: 'editor', email: 'e@x.com' }) }))).status, 403);
    assert.equal((await handleNotify(post({ to: 'a@b.co', subject: 's', html: 'h' }, 'user-jwt'), deps())).status, 400);
    assert.equal((await handleNotify(post({ to: 'a@b.co', subject: 's', html: 'h' }, ''), deps())).status, 401);
  });

  test('missing setup and GoHighLevel errors come back readable', async () => {
    const unset = deps({ getConfig: async () => ({ location_id: null, token: null, from_email: null, from_name: 'Archimedes' }) });
    assert.match((await (await handleNotify(post({ to: 'a@b.co', subject: 's', html: 'h' }), unset)).json()).error, /Save the GoHighLevel/);
    const failing = deps({ sendEmail: async () => { throw new Error('GoHighLevel said (401): Invalid token'); } });
    const response = await handleNotify(post({ action: 'test' }, 'jwt'), failing);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /401/);
    assert.deepEqual(failing.calls.at(-1), ['log', false, 'admin@example.com']);
  });
});
