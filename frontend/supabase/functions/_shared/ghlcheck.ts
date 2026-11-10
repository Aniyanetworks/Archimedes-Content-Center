// Tests a sub-account's saved GoHighLevel token. Kept free of Deno APIs so tests can run it.
// The token is read on the server and never sent to the browser.

export interface GhlCheckDeps {
  portalUrl: string;
  extraOrigins: string[];
  callerRole(authorization: string): Promise<string | null>;
  target(tenantId: string): Promise<{ location_id: string | null; token: string | null } | null>;
  // Calls GoHighLevel with the token and returns the HTTP status and any message.
  probe(locationId: string, token: string): Promise<{ status: number; message: string }>;
  log(authorization: string, tenantId: string, ok: boolean, message: string): Promise<void>;
}

function allowedOrigin(request: Request, deps: GhlCheckDeps): string {
  const portal = new URL(deps.portalUrl).origin;
  const origin = request.headers.get('Origin') ?? '';
  return [portal, ...deps.extraOrigins].includes(origin) ? origin : portal;
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  });
}

// What a GoHighLevel answer means, in plain words.
export function explain(status: number, message: string): { ok: boolean; message: string } {
  if (status >= 200 && status < 300) return { ok: true, message: 'Connected. GoHighLevel accepted the token for this location.' };
  if (status === 401) return { ok: false, message: 'GoHighLevel did not accept the token. It may be wrong, expired or deleted. Create a new one and save it again.' };
  if (status === 403) return { ok: false, message: 'The token works, but it is missing permissions or belongs to a different location. Check the location ID and the email campaign permissions.' };
  if (status === 404) return { ok: false, message: 'GoHighLevel could not find this location. Check the GHL location ID.' };
  if (status === 429) return { ok: false, message: 'GoHighLevel is busy right now. Try again in a minute.' };
  return { ok: false, message: `GoHighLevel answered with an error (${status})${message ? `: ${message}` : ''}. Try again later.` };
}

export async function handleGhlCheck(request: Request, deps: GhlCheckDeps): Promise<Response> {
  const origin = allowedOrigin(request, deps);
  if (request.method === 'OPTIONS') return json({}, 200, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Please sign in again.' }, 401, origin);
  const role = await deps.callerRole(authorization).catch(() => null);
  if (role !== 'admin' && role !== 'operator') return json({ error: 'Only admins and operators can test the connection.' }, 403, origin);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400, origin);
  }
  const tenantId = String(body.tenant_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return json({ error: 'Unknown sub-account.' }, 400, origin);

  const target = await deps.target(tenantId);
  if (!target) return json({ error: 'This sub-account no longer exists.' }, 404, origin);
  if (!target.location_id) return json({ ok: false, message: 'Add the GHL location ID first.' }, 200, origin);
  if (!target.token) return json({ ok: false, message: 'No token is saved yet. Paste the token and click Save.' }, 200, origin);

  let result: { ok: boolean; message: string };
  try {
    const answer = await deps.probe(target.location_id, target.token);
    result = explain(answer.status, answer.message);
  } catch {
    result = { ok: false, message: 'Could not reach GoHighLevel. Try again in a minute.' };
  }
  await deps.log(authorization, tenantId, result.ok, result.message).catch(() => undefined);
  return json(result, 200, origin);
}
