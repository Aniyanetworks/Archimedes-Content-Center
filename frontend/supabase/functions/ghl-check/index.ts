// Tests a sub-account's GoHighLevel token from the app. Deploy with --no-verify-jwt: the handler checks the caller itself.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { handleGhlCheck, type GhlCheckDeps } from '../_shared/ghlcheck.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const url = required('SUPABASE_URL');
const anonKey = required('SUPABASE_ANON_KEY');
const admin = createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const asCaller = (authorization: string) =>
  createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });

async function loadDeps(): Promise<GhlCheckDeps> {
  const { data, error } = await admin.rpc('review_config', {});
  if (error) throw new Error(error.message);
  return {
    portalUrl: (data as { portal_url: string }).portal_url,
    extraOrigins: ['http://localhost:5173'],
    async callerRole(authorization) {
      const { data: role } = await asCaller(authorization).rpc('staff_role');
      return (role as string | null) ?? null;
    },
    async target(tenantId) {
      const { data: target, error: targetError } = await admin.rpc('tenant_ghl_check_target', { p_tenant: tenantId });
      if (targetError) throw new Error(targetError.message);
      return (target as { location_id: string | null; token: string | null } | null) ?? null;
    },
    async probe(locationId, token) {
      // The same read workflow 11 uses for delivery numbers, so it needs the permissions the newsletter needs anyway.
      const query = new URLSearchParams({ locationId, limit: '1', campaignsOnly: 'true' });
      const response = await fetch(`https://services.leadconnectorhq.com/emails/schedule?${query}`, {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
      });
      const text = await response.text();
      let message = '';
      try {
        const parsed = JSON.parse(text);
        message = Array.isArray(parsed.message) ? parsed.message.join(', ') : String(parsed.message ?? '');
      } catch {
        message = text.slice(0, 120);
      }
      return { status: response.status, message };
    },
    async log(authorization, tenantId, ok, message) {
      await asCaller(authorization).rpc('log_tenant_ghl_check', { p_tenant: tenantId, p_ok: ok, p_message: message });
    },
  };
}

Deno.serve(async (request) => {
  try {
    return await handleGhlCheck(request, await loadDeps());
  } catch (error) {
    const origin = request.headers.get('Origin') ?? '*';
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'The connection test failed.' }), {
      status: request.method === 'OPTIONS' ? 200 : 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
    });
  }
});
