// Request handling for both Edge Functions, kept free of Deno APIs so tests can run it directly.
import { safeEqual, signToken, verifyToken, type ReviewClaims } from './token.ts';

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface Deps {
  rpc: Rpc;
  signingSecret: string;
  portalUrl: string;
  serviceKey: string;
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

// Messages raised on purpose by review_* functions are safe to show. Anything else stays generic.
const REVIEWER_MESSAGES = [
  'This review link', 'This review is closed', 'This newsletter has changed', 'A decision has already', 'Please describe', 'Unknown action',
];

function publicMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return REVIEWER_MESSAGES.some((prefix) => message.startsWith(prefix)) ? message : 'This review link could not be verified.';
}

const ACTIONS = ['view', 'approve', 'request_changes', 'skip'];

export async function handleReview(request: Request, deps: Deps): Promise<Response> {
  const origin = new URL(deps.portalUrl).origin;
  if (request.method === 'OPTIONS') return json({}, 200, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400, origin);
  }
  const action = String(body.action ?? '');
  if (!ACTIONS.includes(action)) return json({ error: 'Unknown action' }, 400, origin);

  const claims: ReviewClaims | null = await verifyToken(String(body.token ?? ''), deps.signingSecret);
  if (!claims) return json({ error: 'This review link is invalid or has expired.' }, 401, origin);
  const identity = { p_jti: claims.jti, p_campaign: claims.cid, p_tenant: claims.tid, p_hash: claims.hash };

  try {
    if (action === 'view') return json(await deps.rpc('review_view', identity), 200, origin);
    const result = await deps.rpc('review_decide', {
      ...identity,
      p_action: action,
      p_version_hash: String(body.version_hash ?? ''),
      p_notes: typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null,
      p_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      p_user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    });
    return json(result, 200, origin);
  } catch (error) {
    return json({ error: publicMessage(error) }, 409, origin);
  }
}

// Called by n8n with the service credential. The signing secret stays inside Supabase.
export async function handleIssue(request: Request, deps: Deps): Promise<Response> {
  const origin = new URL(deps.portalUrl).origin;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!deps.serviceKey || !safeEqual(bearer, deps.serviceKey)) return json({ error: 'Unauthorized' }, 401, origin);

  const { campaign_id: campaignId } = await request.json();
  try {
    const issued = (await deps.rpc('issue_review_token', { p_campaign: campaignId })) as ReviewClaims & { to: string };
    const { to, ...claims } = issued;
    const token = await signToken(claims, deps.signingSecret);
    return json({ url: `${deps.portalUrl.replace(/\/$/, '')}/review/${token}`, to, expires_at: new Date(claims.exp * 1000).toISOString() }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not issue a link' }, 409, origin);
  }
}
