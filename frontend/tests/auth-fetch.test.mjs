import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createAuthFetch, isExpiredJwt } from '../src/api/authFetch.ts';

const expired = () => new Response('{"code":"PGRST303","message":"JWT expired"}', { status: 401 });
const ok = () => new Response('[]', { status: 200 });
const REST = 'https://x.supabase.co/rest/v1/staff_roles';

function scripted(...responses) {
  const calls = [];
  const fetchMock = async (input, init) => {
    calls.push({ input, authorization: new Headers(init?.headers).get('authorization') });
    return responses.shift()();
  };
  return { fetchMock, calls };
}

describe('expired token handling', () => {
  test('recognizes only an expired token', () => {
    assert.equal(isExpiredJwt(401, '{"message":"JWT expired"}'), true);
    assert.equal(isExpiredJwt(401, '{"message":"permission denied"}'), false);
    assert.equal(isExpiredJwt(500, 'JWT expired'), false);
  });

  test('renews and retries once with the new token', async () => {
    const { fetchMock, calls } = scripted(expired, ok);
    let renewals = 0;
    const authFetch = createAuthFetch(fetchMock, async () => { renewals += 1; return 'new-token'; });
    const response = await authFetch(REST, { headers: { Authorization: 'Bearer old-token', apikey: 'k' } });
    assert.equal(response.status, 200);
    assert.equal(renewals, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].authorization, 'Bearer new-token');
  });

  test('does not loop if the retry also fails', async () => {
    const { fetchMock, calls } = scripted(expired, expired, ok);
    const response = await createAuthFetch(fetchMock, async () => 'new-token')(REST, {});
    assert.equal(response.status, 401);
    assert.equal(calls.length, 2);
  });

  test('other errors pass straight through without a renewal', async () => {
    for (const make of [() => new Response('{"message":"permission denied"}', { status: 401 }), () => new Response('down', { status: 500 }), ok]) {
      const { fetchMock, calls } = scripted(make);
      let renewals = 0;
      await createAuthFetch(fetchMock, async () => { renewals += 1; return 'x'; })(REST, {});
      assert.equal(renewals, 0);
      assert.equal(calls.length, 1);
    }
  });

  test('a failed renewal returns the original response', async () => {
    const { fetchMock, calls } = scripted(expired);
    const response = await createAuthFetch(fetchMock, async () => null)(REST, {});
    assert.equal(response.status, 401);
    assert.equal(calls.length, 1);
  });

  test('the renewal call itself is never intercepted', async () => {
    const { fetchMock, calls } = scripted(expired);
    let renewals = 0;
    await createAuthFetch(fetchMock, async () => { renewals += 1; return 'x'; })('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', {});
    assert.equal(renewals, 0);
    assert.equal(calls.length, 1);
  });

  test('parallel requests share one renewal', async () => {
    const { fetchMock } = scripted(expired, expired, ok, ok);
    let renewals = 0;
    const authFetch = createAuthFetch(fetchMock, async () => { renewals += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return 'new-token'; });
    const results = await Promise.all([authFetch(REST, {}), authFetch(REST, {})]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.equal(renewals, 1);
  });
});
