// Invite a staff member. Kept free of Deno APIs so tests can run it directly.

export interface StaffDeps {
  portalUrl: string;
  // Origins allowed to call this function, besides the portal itself (for local development).
  extraOrigins: string[];
  // The caller's role, read with the caller's own token.
  callerRole(authorization: string): Promise<string | null>;
  // Create the login and email the invite. Returns the new user's id, or null when the email already has a confirmed login.
  invite(email: string, redirectTo: string): Promise<string | null>;
  findUser(email: string): Promise<string | null>;
  // Runs set_staff_role as the caller, so the database checks the role again and the audit log names them.
  setRole(authorization: string, userId: string, role: string): Promise<void>;
}

const ROLES = ['admin', 'editor', 'operator'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowedOrigin(request: Request, deps: StaffDeps): string {
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

export async function handleStaffInvite(request: Request, deps: StaffDeps): Promise<Response> {
  const origin = allowedOrigin(request, deps);
  if (request.method === 'OPTIONS') return json({}, 200, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Please sign in again.' }, 401, origin);
  if ((await deps.callerRole(authorization).catch(() => null)) !== 'admin') {
    return json({ error: 'Only admins can invite staff.' }, 403, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400, origin);
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  const role = String(body.role ?? '');
  if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address.' }, 400, origin);
  if (!ROLES.includes(role)) return json({ error: 'Choose a role.' }, 400, origin);

  try {
    let userId = await deps.invite(email, `${origin}/admin/reset-password?welcome=1`);
    let status = 'invited';
    if (!userId) {
      userId = await deps.findUser(email);
      status = 'added';
    }
    if (!userId) return json({ error: 'Could not create a login for this email.' }, 500, origin);
    await deps.setRole(authorization, userId, role);
    return json({ status, email }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The invite could not be sent.' }, 500, origin);
  }
}
