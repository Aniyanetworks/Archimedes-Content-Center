// Called by the admin app's Pause and safety page. Deploy with --no-verify-jwt: the handler checks the caller's role itself.
// Secrets: N8N_BASE_URL (for example https://n8n.example.com), N8N_API_KEY, N8N_EMAIL_WORKFLOW_IDS (comma-separated:
// the workflows that send email, 04, 05 and 09). It only ever touches the one SMTP credential it creates and those workflows.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { handleSmtp, type SmtpConfig, type SmtpDeps, type SmtpInput, type WorkflowState } from '../_shared/smtp.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const CREDENTIAL_NAME = 'Archimedes SMTP';
const url = required('SUPABASE_URL');
const anonKey = required('SUPABASE_ANON_KEY');
const admin = createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const asCaller = (authorization: string) =>
  createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });

// The n8n details come from Edge Function secrets if set, otherwise from Vault (see migration 0015).
let n8nBase = '';
let n8nKey = '';
let workflowIds: string[] = [];
async function loadN8n() {
  if (n8nKey) return;
  const { data, error } = await admin.rpc('n8n_config', {});
  if (error) throw new Error(error.message);
  const vault = (data ?? {}) as { base_url?: string; api_key?: string; email_workflow_ids?: string };
  const base = Deno.env.get('N8N_BASE_URL') ?? vault.base_url;
  const key = Deno.env.get('N8N_API_KEY') ?? vault.api_key;
  const ids = Deno.env.get('N8N_EMAIL_WORKFLOW_IDS') ?? vault.email_workflow_ids;
  if (!base || !key || !ids) throw new Error('The connection to n8n is not set up yet (n8n_base_url, n8n_api_key, n8n_email_workflow_ids).');
  n8nBase = base.replace(/\/+$/, '') + '/api/v1';
  n8nKey = key;
  workflowIds = ids.split(',').map((id) => id.trim()).filter(Boolean);
}
const SETTINGS_KEYS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder', 'callerPolicy', 'callerIds'];

async function n8n(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(n8nBase + path, { ...init, headers: { 'X-N8N-API-KEY': n8nKey, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
}

async function n8nJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await n8n(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n said: ${(() => { try { return JSON.parse(text).message; } catch { return text.slice(0, 200); } })()}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// n8n's SMTP credential: with SSL on, disableStartTls must be left out; with SSL off, it must be given.
const credentialData = (input: SmtpInput) => ({
  host: input.host, port: input.port, user: input.user, password: input.password, secure: input.secure,
  ...(input.secure ? {} : { disableStartTls: false }),
});

async function workflow(id: string) {
  return await n8nJson<{ id: string; name: string; active: boolean; nodes: Array<{ type: string; credentials?: Record<string, unknown> }>; connections: unknown; settings?: Record<string, unknown>; staticData?: unknown }>(`/workflows/${id}`);
}

async function loadDeps(): Promise<SmtpDeps> {
  const { data: config, error } = await admin.rpc('review_config', {});
  if (error) throw new Error(error.message);
  await loadN8n();
  return {
    portalUrl: (config as { portal_url: string }).portal_url,
    extraOrigins: ['http://localhost:5173'],
    async callerRole(authorization) {
      const { data } = await asCaller(authorization).rpc('staff_role');
      return (data as string | null) ?? null;
    },
    async getConfig() {
      const { data } = await admin.from('system_settings').select('value').eq('key', 'smtp_config').maybeSingle();
      return (data?.value as SmtpConfig | null) ?? null;
    },
    async senderEmailSet() {
      const { data } = await admin.from('system_settings').select('value').eq('key', 'notification_from_email').maybeSingle();
      return typeof data?.value === 'string' && data.value.includes('@');
    },
    async channel() {
      const { data } = await admin.from('system_settings').select('value').eq('key', 'notification_channel').maybeSingle();
      return data?.value === 'ghl' ? 'ghl' : 'smtp';
    },
    async ghlReady() {
      const { data } = await admin.rpc('notification_ghl_config', {});
      const ghl = (data ?? {}) as { location_id?: string | null; token?: string | null };
      return !!ghl.location_id && !!ghl.token;
    },
    async saveConfig(authorization, saved) {
      const { error: saveError } = await asCaller(authorization).rpc('save_smtp_config', { p_config: saved });
      if (saveError) throw new Error(saveError.message);
    },
    async logEvent(authorization, action, details) {
      await asCaller(authorization).rpc('log_smtp_event', { p_action: action, p_details: details });
    },
    async createCredential(input) {
      const created = await n8nJson<{ id: string }>('/credentials', { method: 'POST', body: JSON.stringify({ name: CREDENTIAL_NAME, type: 'smtp', data: credentialData(input) }) });
      return created.id;
    },
    async updateCredential(id, input) {
      const response = await n8n(`/credentials/${id}`, { method: 'PATCH', body: JSON.stringify({ name: CREDENTIAL_NAME, type: 'smtp', data: credentialData(input) }) });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`n8n said: ${(await response.text()).slice(0, 200)}`);
      return true;
    },
    async testCredential(id) {
      const result = await n8nJson<{ status: string; message: string }>(`/credentials/${id}/test`, { method: 'POST' });
      return { ok: result.status === 'OK', message: result.message };
    },
    async linkWorkflows(credentialId) {
      for (const id of workflowIds) {
        const w = await workflow(id);
        let changed = false;
        for (const node of w.nodes) {
          if (!node.type.includes('emailSend')) continue;
          const current = (node.credentials?.smtp ?? {}) as { id?: string };
          if (current.id === credentialId) continue;
          node.credentials = { ...(node.credentials ?? {}), smtp: { id: credentialId, name: CREDENTIAL_NAME } };
          changed = true;
        }
        if (!changed) continue;
        const settings = Object.fromEntries(Object.entries(w.settings ?? {}).filter(([key]) => SETTINGS_KEYS.includes(key)));
        await n8nJson(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify({ name: w.name, nodes: w.nodes, connections: w.connections, settings, staticData: w.staticData ?? null }) });
      }
    },
    async workflowStates() {
      const states: WorkflowState[] = [];
      for (const id of workflowIds) {
        const w = await workflow(id);
        states.push({ id: w.id, name: w.name, active: w.active });
      }
      return states;
    },
    async setWorkflowsActive(active) {
      for (const id of workflowIds) await n8nJson(`/workflows/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' });
      const states: WorkflowState[] = [];
      for (const id of workflowIds) {
        const w = await workflow(id);
        states.push({ id: w.id, name: w.name, active: w.active });
      }
      return states;
    },
  };
}

// If setup is incomplete, still answer with a readable message (and CORS headers, so the browser can show it).
Deno.serve(async (request) => {
  try {
    return await handleSmtp(request, await loadDeps());
  } catch (error) {
    const origin = request.headers.get('Origin') ?? '*';
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'The email settings service is not set up.' }), {
      status: request.method === 'OPTIONS' ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }
});
