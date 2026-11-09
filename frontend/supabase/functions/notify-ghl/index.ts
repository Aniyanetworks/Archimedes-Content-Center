// Sends a notification email through GoHighLevel. Deploy with --no-verify-jwt: the handler checks the caller itself.
// n8n calls it with the service key; admins call it from the app to send themselves a test.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { handleNotify, type NotifyConfig, type NotifyDeps } from '../_shared/notify.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const GHL = 'https://services.leadconnectorhq.com';
const url = required('SUPABASE_URL');
const anonKey = required('SUPABASE_ANON_KEY');
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const asCaller = (authorization: string) =>
  createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });

async function ghl<T>(config: NotifyConfig, path: string, version: string, body: unknown): Promise<T> {
  const response = await fetch(GHL + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, Version: version, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // keep the raw text for the error message
  }
  if (!response.ok) {
    const detail = (parsed.message ?? parsed.error ?? text.slice(0, 200)) as string;
    throw new Error(`GoHighLevel said (${response.status}): ${Array.isArray(detail) ? detail.join(', ') : detail}`);
  }
  return parsed as T;
}

async function loadDeps(): Promise<NotifyDeps> {
  const { data, error } = await admin.rpc('review_config', {});
  if (error) throw new Error(error.message);
  return {
    portalUrl: (data as { portal_url: string }).portal_url,
    extraOrigins: ['http://localhost:5173'],
    serviceKey,
    async getConfig() {
      const { data: config, error: configError } = await admin.rpc('notification_ghl_config', {});
      if (configError) throw new Error(configError.message);
      return config as NotifyConfig;
    },
    async caller(authorization) {
      const client = asCaller(authorization);
      const [{ data: role }, { data: user }] = await Promise.all([client.rpc('staff_role'), client.auth.getUser(authorization.slice(7))]);
      return { role: (role as string | null) ?? null, email: user.user?.email ?? null };
    },
    async upsertContact(config, email, name) {
      const result = await ghl<{ contact?: { id?: string } }>(config, '/contacts/upsert', '2021-07-28', {
        locationId: config.location_id, email, ...(name ? { name } : {}), source: 'Archimedes notifications',
      });
      if (!result.contact?.id) throw new Error('GoHighLevel did not return a contact for this address.');
      return result.contact.id;
    },
    async sendEmail(config, contactId, email) {
      const result = await ghl<{ messageId?: string; emailMessageId?: string }>(config, '/conversations/messages', '2021-04-15', {
        type: 'Email', contactId, subject: email.subject, html: email.html, ...(email.from ? { emailFrom: email.from } : {}),
      });
      return result.messageId ?? result.emailMessageId ?? '';
    },
    async logTest(authorization, ok, to) {
      await asCaller(authorization).rpc('log_notification_test', { p_channel: 'ghl', p_ok: ok, p_to: to });
    },
  };
}

Deno.serve(async (request) => {
  try {
    return await handleNotify(request, await loadDeps());
  } catch (error) {
    const origin = request.headers.get('Origin') ?? '*';
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'The notification service failed.' }), {
      status: request.method === 'OPTIONS' ? 200 : 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
    });
  }
});
