// Sends one notification email through GoHighLevel. Kept free of Deno APIs so tests can run it.
// Called by n8n (with the service key) for review invites, missed deadlines and alerts,
// and by an admin in the app (with their own sign-in) to send a test email to themselves.
// The GHL token stays on the server: n8n never sees it.

export interface NotifyConfig {
  location_id: string | null;
  token: string | null;
  from_email: string | null;
  from_name: string;
}

export interface NotifyDeps {
  portalUrl: string;
  extraOrigins: string[];
  serviceKey: string;
  getConfig(): Promise<NotifyConfig>;
  // The signed-in caller, for the test email.
  caller(authorization: string): Promise<{ role: string | null; email: string | null }>;
  upsertContact(config: NotifyConfig, email: string, name?: string): Promise<string>;
  sendEmail(config: NotifyConfig, contactId: string, email: { subject: string; html: string; from: string | null }): Promise<string>;
  logTest(authorization: string, ok: boolean, to: string): Promise<void>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowedOrigin(request: Request, deps: NotifyDeps): string {
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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const TEST_HTML = '<p>This is a test email from Archimedes.</p><p>If you can read this, notification emails sent through GoHighLevel are working.</p>';

export async function handleNotify(request: Request, deps: NotifyDeps): Promise<Response> {
  const origin = allowedOrigin(request, deps);
  if (request.method === 'OPTIONS') return json({}, 200, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const authorization = request.headers.get('Authorization') ?? '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!bearer) return json({ error: 'Please sign in again.' }, 401, origin);
  const fromService = safeEqual(bearer, deps.serviceKey);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400, origin);
  }

  let to: string;
  let subject: string;
  let html: string;
  let name: string | undefined;
  if (fromService) {
    to = String(body.to ?? '').trim().toLowerCase();
    subject = String(body.subject ?? '').trim();
    html = String(body.html ?? '');
    name = body.name ? String(body.name) : undefined;
    if (!EMAIL.test(to)) return json({ error: 'A valid "to" address is required.' }, 400, origin);
    if (!subject || !html) return json({ error: 'Subject and html are required.' }, 400, origin);
  } else {
    // An admin's test: always to their own address, with fixed content.
    if (body.action !== 'test') return json({ error: 'Unknown action' }, 400, origin);
    const caller = await deps.caller(authorization).catch(() => ({ role: null, email: null }));
    if (caller.role !== 'admin') return json({ error: 'Only admins can send a test email.' }, 403, origin);
    if (!caller.email) return json({ error: 'Your account has no email address.' }, 400, origin);
    to = caller.email.toLowerCase();
    subject = 'Archimedes test email (GoHighLevel)';
    html = TEST_HTML;
  }

  const config = await deps.getConfig();
  if (!config.location_id || !config.token) {
    return json({ error: 'Save the GoHighLevel location and token under Pause and safety first.' }, 400, origin);
  }
  const from = config.from_email ? `${config.from_name} <${config.from_email}>` : null;

  try {
    const contactId = await deps.upsertContact(config, to, name);
    const messageId = await deps.sendEmail(config, contactId, { subject, html, from });
    if (!fromService) await deps.logTest(authorization, true, to);
    return json({ ok: true, to, messageId }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GoHighLevel did not accept the email.';
    if (!fromService) await deps.logTest(authorization, false, to).catch(() => undefined);
    return json({ ok: false, error: message }, 502, origin);
  }
}
