// Email server (SMTP) settings for n8n, managed by admins from the app. Kept free of Deno APIs so tests can run it.
// The password is passed straight to n8n and never returned or stored by us.

export interface SmtpConfig {
  credential_id: string;
  host: string;
  port: number;
  user: string;
  secure: boolean;
  updated_at: string;
}

export interface SmtpInput {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
}

export interface WorkflowState {
  id: string;
  name: string;
  active: boolean;
}

export interface SmtpDeps {
  portalUrl: string;
  extraOrigins: string[];
  callerRole(authorization: string): Promise<string | null>;
  getConfig(): Promise<SmtpConfig | null>;
  senderEmailSet(): Promise<boolean>;
  // Which way notification emails go, and whether GoHighLevel has a location and token saved.
  channel(): Promise<'smtp' | 'ghl'>;
  ghlReady(): Promise<boolean>;
  saveConfig(authorization: string, config: SmtpConfig): Promise<void>;
  logEvent(authorization: string, action: string, details: Record<string, unknown>): Promise<void>;
  // n8n. createCredential returns the new id; updateCredential returns false when the credential no longer exists.
  createCredential(input: SmtpInput): Promise<string>;
  updateCredential(id: string, input: SmtpInput): Promise<boolean>;
  testCredential(id: string): Promise<{ ok: boolean; message: string }>;
  linkWorkflows(credentialId: string): Promise<void>;
  workflowStates(): Promise<WorkflowState[]>;
  setWorkflowsActive(active: boolean): Promise<WorkflowState[]>;
}

function allowedOrigin(request: Request, deps: SmtpDeps): string {
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

// Checks what was typed and returns a plain-English problem, or the cleaned-up settings.
export function validateSmtp(body: Record<string, unknown>): { error: string } | { input: SmtpInput } {
  const host = String(body.host ?? '').trim();
  const user = String(body.user ?? '').trim();
  const password = String(body.password ?? '');
  const port = Number(body.port);
  const secure = body.secure === true;
  if (!host || /\s|\//.test(host)) return { error: 'Enter the server address, for example smtp.gmail.com.' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'Enter a port number, usually 465 or 587.' };
  if (!user) return { error: 'Enter the username, usually the full email address.' };
  if (!password) return { error: 'Enter the password.' };
  return { input: { host, port, user, password, secure } };
}

export async function handleSmtp(request: Request, deps: SmtpDeps): Promise<Response> {
  const origin = allowedOrigin(request, deps);
  if (request.method === 'OPTIONS') return json({}, 200, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Please sign in again.' }, 401, origin);
  if ((await deps.callerRole(authorization).catch(() => null)) !== 'admin') {
    return json({ error: 'Only admins can change the email server.' }, 403, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400, origin);
  }

  try {
    const config = await deps.getConfig();
    switch (body.action) {
      case 'status':
        return json({ config, workflows: await deps.workflowStates() }, 200, origin);

      case 'save': {
        const checked = validateSmtp(body);
        if ('error' in checked) return json({ error: checked.error }, 400, origin);
        let id = config?.credential_id ?? null;
        // Update the connection we made before; if someone deleted it in n8n, make a new one.
        if (!id || !(await deps.updateCredential(id, checked.input))) id = await deps.createCredential(checked.input);
        await deps.linkWorkflows(id);
        const saved: SmtpConfig = {
          credential_id: id, host: checked.input.host, port: checked.input.port, user: checked.input.user,
          secure: checked.input.secure, updated_at: new Date().toISOString(),
        };
        await deps.saveConfig(authorization, saved);
        const test = await deps.testCredential(id);
        await deps.logEvent(authorization, 'smtp.tested', { ok: test.ok });
        return json({ config: saved, test, workflows: await deps.workflowStates() }, 200, origin);
      }

      case 'test': {
        if (!config) return json({ error: 'Save the email server first.' }, 400, origin);
        const test = await deps.testCredential(config.credential_id);
        await deps.logEvent(authorization, 'smtp.tested', { ok: test.ok });
        return json({ test }, 200, origin);
      }

      case 'workflows': {
        const on = body.on === true;
        if (on) {
          const channel = await deps.channel();
          if (channel === 'smtp' && !config) return json({ error: 'Save the email server first.' }, 400, origin);
          if (channel === 'ghl' && !(await deps.ghlReady())) return json({ error: 'Save the GoHighLevel location and token first.' }, 400, origin);
          if (!(await deps.senderEmailSet())) return json({ error: 'Fill in the Sender email under Notification emails first.' }, 400, origin);
          if (config) await deps.linkWorkflows(config.credential_id);
        }
        const workflows = await deps.setWorkflowsActive(on);
        await deps.logEvent(authorization, on ? 'email_workflows.on' : 'email_workflows.off', { workflows: workflows.map((w) => w.name) });
        return json({ workflows }, 200, origin);
      }

      default:
        return json({ error: 'Unknown action' }, 400, origin);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Something went wrong talking to n8n.' }, 502, origin);
  }
}
