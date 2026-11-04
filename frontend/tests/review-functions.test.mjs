// The Edge Function handlers and signed tokens, wired to the real SQL.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { handleIssue, handleReview } from '../supabase/functions/_shared/handlers.ts';
import { signToken, verifyToken } from '../supabase/functions/_shared/token.ts';
import { addApprovedEdition, addTenant, campaign, createDb, mondayFromNow, publish } from './helpers.mjs';

const SECRET = 'test-signing-secret-at-least-32-characters';
const SERVICE_KEY = 'service-key';
let deps;
let db;

function post(body, headers = {}) {
  return new Request('http://functions.test/review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

async function newReview(week) {
  const t = await addTenant(db, { review: 'review' });
  const edition = await addApprovedEdition(db, { week: mondayFromNow(week) });
  const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
  const response = await handleIssue(post({ campaign_id: c.id }, { Authorization: `Bearer ${SERVICE_KEY}` }), deps);
  assert.equal(response.status, 200);
  const issued = await response.json();
  return { c, issued, token: issued.url.split('/review/')[1] };
}

before(async () => {
  db = await createDb();
  await db.exec(`update system_settings set value = '["internal@example.com"]' where key = 'internal_preview_addresses';`);
  deps = {
    serviceKey: SERVICE_KEY,
    signingSecret: SECRET,
    portalUrl: 'https://portal.example.com',
    rpc: async (name, args) => {
      const keys = Object.keys(args);
      const sql = `select ${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')}) as result`;
      return (await db.query(sql, Object.values(args))).rows[0].result;
    },
  };
});

describe('signed tokens', () => {
  const claims = { jti: 'j', cid: 'c', tid: 't', hash: 'h', exp: Math.floor(Date.now() / 1000) + 60 };

  test('a valid token verifies', async () => {
    assert.deepEqual(await verifyToken(await signToken(claims, SECRET), SECRET), claims);
  });

  test('tampered, wrongly signed, expired and malformed tokens are refused', async () => {
    const token = await signToken(claims, SECRET);
    const [payload, signature] = token.split('.');
    const forged = btoa(JSON.stringify({ ...claims, hash: 'other' })).replace(/=+$/, '');
    assert.equal(await verifyToken(`${forged}.${signature}`, SECRET), null);
    assert.equal(await verifyToken(`${payload}.${signature}x`, SECRET), null);
    assert.equal(await verifyToken(token, 'another-secret'), null);
    assert.equal(await verifyToken(await signToken({ ...claims, exp: 1 }, SECRET), SECRET), null);
    assert.equal(await verifyToken('nonsense', SECRET), null);
    assert.equal(await verifyToken('', SECRET), null);
  });
});

describe('review-issue', () => {
  test('refuses callers without the service credential', async () => {
    assert.equal((await handleIssue(post({ campaign_id: 'x' }), deps)).status, 401);
    assert.equal((await handleIssue(post({ campaign_id: 'x' }, { Authorization: 'Bearer wrong' }), deps)).status, 401);
  });

  test('a test-mode tenant has its invite redirected to an internal address', async () => {
    const { issued } = await newReview(2);
    assert.equal(issued.to, 'internal@example.com');
    assert.match(issued.url, /^https:\/\/portal\.example\.com\/review\//);
  });
});

describe('review portal API', () => {
  test('shows the exact rendered version', async () => {
    const { c, token } = await newReview(3);
    const response = await handleReview(post({ token, action: 'view' }), deps);
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.equal(view.state, 'pending');
    assert.equal(view.version_hash, c.rendered_html_hash);
    assert.equal(view.html, c.rendered_html);
    assert.equal(view.timezone, 'America/Denver');
  });

  test('approval through the API moves the campaign and is recorded with the reviewer', async () => {
    const { c, token } = await newReview(4);
    const response = await handleReview(post({ token, action: 'approve', version_hash: c.rendered_html_hash }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'Test' }), deps);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'decided');
    assert.equal((await campaign(db, c.id)).status, 'APPROVED_FOR_SEND');
    const event = (await db.query('select * from approval_events where campaign_id = $1', [c.id])).rows[0];
    assert.equal(event.decision, 'approved');
    assert.equal(event.version_hash, c.rendered_html_hash);
    assert.equal(event.reviewer_identity, 'internal@example.com');
    assert.equal(event.ip, '203.0.113.9');
  });

  test('viewing never decides anything, so email scanners cannot approve', async () => {
    const { c, token } = await newReview(5);
    await handleReview(post({ token, action: 'view' }), deps);
    await handleReview(post({ token, action: 'view' }), deps);
    assert.equal((await campaign(db, c.id)).status, 'CLIENT_REVIEW_PENDING');
    assert.equal((await handleReview(new Request('http://functions.test/review?token=' + token), deps)).status, 405);
  });

  test('refuses a stale page, a forged token and an unknown action', async () => {
    const { c, token } = await newReview(6);
    const stale = await handleReview(post({ token, action: 'approve', version_hash: 'old' }), deps);
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /has changed/);
    assert.equal((await handleReview(post({ token: token + 'x', action: 'approve', version_hash: c.rendered_html_hash }), deps)).status, 401);
    assert.equal((await handleReview(post({ token, action: 'delete' }), deps)).status, 400);
    assert.equal((await campaign(db, c.id)).status, 'CLIENT_REVIEW_PENDING');
  });

  test('a validly signed token with no database row is refused', async () => {
    const { c } = await newReview(7);
    const token = await signToken({ jti: crypto.randomUUID(), cid: c.id, tid: c.tenant_id, hash: c.rendered_html_hash, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
    const response = await handleReview(post({ token, action: 'approve', version_hash: c.rendered_html_hash }), deps);
    assert.equal(response.status, 409);
    assert.equal((await campaign(db, c.id)).status, 'CLIENT_REVIEW_PENDING');
  });

  test('database errors are not exposed to the public page', async () => {
    const response = await handleReview(post({ token: await signToken({ jti: 'not-a-uuid', cid: 'x', tid: 'y', hash: 'z', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET), action: 'view' }), deps);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'This review link could not be verified.');
  });
});
