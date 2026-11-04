import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import type { Deps } from './handlers.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

// Supabase provides the URL and service key. The signing secret and portal URL come from review_config().
export async function loadDeps(): Promise<Deps> {
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(required('SUPABASE_URL'), serviceKey, { auth: { persistSession: false } });
  const rpc: Deps['rpc'] = async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const config = (await rpc('review_config', {})) as { signing_secret: string; portal_url: string };
  if (!config.signing_secret || !config.portal_url) throw new Error('Review config is incomplete');
  return { serviceKey, signingSecret: config.signing_secret, portalUrl: config.portal_url, rpc };
}