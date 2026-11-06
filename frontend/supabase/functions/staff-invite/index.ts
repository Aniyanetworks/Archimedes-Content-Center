// Called by the admin app's Staff page. Deploy with --no-verify-jwt: the handler checks the caller's role itself.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { handleStaffInvite, type StaffDeps } from '../_shared/staff.ts';

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

async function loadDeps(): Promise<StaffDeps> {
  const { data: config, error } = await admin.rpc('review_config', {});
  if (error) throw new Error(error.message);
  return {
    portalUrl: (config as { portal_url: string }).portal_url,
    extraOrigins: ['http://localhost:5173'],
    async callerRole(authorization) {
      const { data } = await asCaller(authorization).rpc('staff_role');
      return (data as string | null) ?? null;
    },
    async invite(email, redirectTo) {
      const { data, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (!inviteError) return data.user?.id ?? null;
      // A confirmed login already exists for this email: it is added without a new invite.
      if (/already (been )?registered|already exists/i.test(inviteError.message)) return null;
      throw new Error(inviteError.message);
    },
    async findUser(email) {
      const { data, error: findError } = await admin.rpc('staff_user_id_by_email', { p_email: email });
      if (findError) throw new Error(findError.message);
      return (data as string | null) ?? null;
    },
    async setRole(authorization, userId, role) {
      const { error: roleError } = await asCaller(authorization).rpc('set_staff_role', { p_user: userId, p_role: role });
      if (roleError) throw new Error(roleError.message);
    },
  };
}

Deno.serve(async (request) => handleStaffInvite(request, await loadDeps()));
