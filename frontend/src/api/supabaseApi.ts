import { createClient } from '@supabase/supabase-js';
import { createAuthFetch } from './authFetch';
import { AUDIT_CATEGORIES } from './types';
import type {
  Api, AuditEntry, AuditFilters, BrandProfile, CampaignFilters, CampaignRow, ChecklistItem, ContentItem, DashboardCards, Edition, EditionItem,
  Industry, MetricRow, NewsletterPrefs, PauseSwitch, Plan, ReviewView, Session, StaffMember, StaffRole, TemplateInfo, Tenant, TenantListRow,
} from './types';

// Every write goes through an RPC or RLS-protected table. The database enforces access and
// approvals; this file only displays and requests.
export function createSupabaseApi(url: string, anonKey: string): Api {
  // Read before the client starts, because it clears the reset link's details from the URL.
  const linkParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const linkError = linkParams.get('error_description');
  const db = createClient(url, anonKey, {
    global: {
      fetch: createAuthFetch(fetch.bind(globalThis), async (): Promise<string | null> => {
        const { data } = await db.auth.refreshSession();
        return data.session?.access_token ?? null;
      }),
    },
  });

  async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }

  function must<T>(result: { data: T | null; error: { message: string } | null }): T {
    if (result.error) throw new Error(result.error.message);
    return result.data as T;
  }

  async function callReview(body: Record<string, unknown>): Promise<ReviewView> {
    const response = await fetch(`${url}/functions/v1/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? 'This link could not be verified.');
    return json as ReviewView;
  }

  function campaignQuery(filters: CampaignFilters) {
    let query = db.from('campaign_overview').select('*', { count: 'exact' });
    for (const key of ['division', 'industry', 'plan_key', 'tenant_id', 'edition_id', 'review_mode', 'status'] as const) {
      const value = filters[key];
      if (value) query = query.eq(key, value);
    }
    if (filters.send_date) {
      const start = new Date(`${filters.send_date}T00:00:00Z`);
      const end = new Date(start.getTime() + 86_400_000);
      query = query.gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString());
    }
    return query;
  }

  function auditQuery(filters: AuditFilters) {
    let query = db.from('audit_log').select('*', { count: 'exact' }).order('id', { ascending: false });
    // Commas and brackets would break the "or" filter, so they are dropped from the search words.
    const words = (filters.search ?? '').replace(/[,()%*]/g, ' ').trim();
    if (words) query = query.or(`action.ilike.%${words}%,actor.ilike.%${words}%`);
    const category = AUDIT_CATEGORIES.find((c) => c.value === filters.category);
    if (category) query = query.filter('action', 'match', category.prefixes.map((prefix) => `^${prefix}[.]`).join('|'));
    if (filters.tenant_id) query = query.eq('tenant_id', filters.tenant_id);
    if (filters.since) query = query.gte('at', filters.since);
    return query;
  }

  return {
    mode: 'live',

    async getSession(): Promise<Session | null> {
      const { data } = await db.auth.getSession();
      if (!data.session) return null;
      const { data: role, error } = await db.from('staff_roles').select('role').eq('user_id', data.session.user.id).maybeSingle();
      if (error) throw new Error(error.message);
      return { email: data.session.user.email ?? '', role: (role?.role as StaffRole) ?? null };
    },
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    async signOut() {
      await db.auth.signOut();
    },
    async requestPasswordReset(email) {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/admin/reset-password` });
      if (error) throw new Error(error.message);
    },
    async updatePassword(password) {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },
    async recoveryStatus() {
      if (linkError) return { ready: false, error: linkError };
      const { data } = await db.auth.getSession(); // waits until the client has read the link
      return { ready: !!data.session, error: null };
    },
    onAuthChange(callback) {
      const { data } = db.auth.onAuthStateChange(() => callback());
      return () => data.subscription.unsubscribe();
    },

    dashboardCards: (filters) => rpc<DashboardCards>('dashboard_cards', { p_filters: filters }),
    async listCampaigns(filters, page, pageSize) {
      const { data, error, count } = await campaignQuery(filters)
        .order('scheduled_at', { ascending: false, nullsFirst: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as CampaignRow[], total: count ?? 0 };
    },
    async getCampaignHtml(id) {
      const row = must(await db.from('campaign_instances').select('rendered_html').eq('id', id).single()) as unknown as { rendered_html: string | null };
      return row.rendered_html;
    },
    async campaignAction(id, action, reason) {
      await rpc(`operator_${action}`, { p_id: id, p_reason: reason ?? null });
    },
    subscribeCampaigns(callback) {
      const channel = db
        .channel('campaign-status')
        // Every status change writes an audit row, and audit rows stay small (no rendered HTML).
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, () => callback())
        .subscribe();
      return () => {
        void db.removeChannel(channel);
      };
    },

    async listTenants() {
      return must(await db.from('tenant_overview').select('*').order('name')) as TenantListRow[];
    },
    async getTenant(id) {
      const [tenant, brand, prefs, plans, campaigns, metrics, events, checklist] = await Promise.all([
        db.from('tenants').select('*').eq('id', id).single(),
        db.from('brand_profiles').select('*').eq('tenant_id', id).single(),
        db.from('newsletter_preferences').select('*').eq('tenant_id', id).single(),
        this.listPlans(),
        db.from('campaign_overview').select('*').eq('tenant_id', id).order('publication_week', { ascending: false }).limit(25),
        db.from('campaign_metrics').select('*').eq('tenant_id', id).order('updated_at', { ascending: false }).limit(25),
        db.from('audit_log').select('*').eq('tenant_id', id).order('id', { ascending: false }).limit(200),
        rpc<ChecklistItem[]>('go_live_checklist', { p_tenant: id }),
      ]);
      const tenantRow = must(tenant) as Tenant;
      return {
        tenant: tenantRow,
        brand: must(brand) as BrandProfile,
        prefs: must(prefs) as NewsletterPrefs,
        plan: plans.find((plan) => plan.plan_key === tenantRow.plan_key) as Plan,
        campaigns: must(campaigns) as CampaignRow[],
        metrics: must(metrics) as MetricRow[],
        events: must(events) as AuditEntry[],
        checklist,
      };
    },
    saveTenant: (tenant, brand, prefs) => rpc<string>('save_tenant', { p_tenant: tenant, p_brand: brand, p_prefs: prefs }),
    changeCadence: async (tenantId, cadence) => {
      await rpc('operator_change_cadence', { p_tenant: tenantId, p_cadence: cadence });
    },
    markTestEmailPassed: async (tenantId) => {
      await rpc('mark_test_email_passed', { p_tenant: tenantId });
    },
    setLiveSend: async (tenantId, enabled) => {
      await rpc('set_live_send', { p_tenant: tenantId, p_enabled: enabled });
    },

    async listPlans() {
      const rows = must(await db.from('plan_entitlements').select('*, plan_templates(template_key)').order('plan_key')) as Array<
        Omit<Plan, 'template_keys'> & { plan_templates: { template_key: string }[] }
      >;
      return rows.map(({ plan_templates, ...plan }) => ({ ...plan, template_keys: plan_templates.map((t) => t.template_key) }));
    },
    async listIndustries() {
      return must(await db.from('industries').select('*').order('label')) as Industry[];
    },
    async listTemplates() {
      const rows = must(
        await db.from('template_versions').select('template_key, version, compiled_html, labels, master_templates(name, position)').eq('is_current', true),
      ) as unknown as Array<{
        template_key: string; version: number; compiled_html: string; labels: TemplateInfo['labels']; master_templates: { name: string; position: number };
      }>;
      return rows
        .map((row) => ({
          key: row.template_key,
          name: row.master_templates.name,
          position: row.master_templates.position,
          version: row.version,
          html: row.compiled_html,
          labels: row.labels,
        }))
        .sort((a, b) => a.position - b.position);
    },

    async listContent() {
      return must(await db.from('content_items').select('*').order('updated_at', { ascending: false }).limit(500)) as ContentItem[];
    },
    async getContent(id) {
      return must(await db.from('content_items').select('*').eq('id', id).single()) as ContentItem;
    },
    saveContent: (item) => rpc<string>('save_content', { p: item }),
    advanceContent: async (id, to, notes) => {
      await rpc('content_advance', { p_id: id, p_to: to, p_notes: notes ?? null });
    },
    newContentVersion: (id) => rpc<string>('content_new_version', { p_id: id }),
    deleteContent: async (id) => {
      await rpc('content_delete', { p_id: id });
    },
    deleteTenant: async (id) => {
      await rpc('tenant_delete', { p_id: id });
    },

    async listEditions() {
      return must(await db.from('editions').select('*').order('publication_week', { ascending: false }).limit(200)) as Edition[];
    },
    async getEdition(id) {
      const [edition, items] = await Promise.all([
        db.from('editions').select('*').eq('id', id).single(),
        db.from('edition_items').select('content_item_id, slot, position').eq('edition_id', id).order('position'),
      ]);
      return { edition: must(edition) as Edition, items: must(items) as EditionItem[] };
    },
    saveEdition: (edition) => rpc<string>('save_edition', { p: edition }),
    setEditionItems: async (id, items) => {
      await rpc('set_edition_items', { p_edition: id, p_items: items });
    },
    submitEdition: async (id) => {
      await rpc('edition_submit', { p_id: id });
    },
    approveEdition: async (id) => {
      await rpc('edition_approve', { p_id: id });
    },
    rejectEdition: async (id, notes) => {
      await rpc('edition_reject', { p_id: id, p_notes: notes });
    },
    deleteEdition: async (id) => {
      await rpc('edition_delete', { p_id: id });
    },

    async listPauses() {
      return must(await db.from('pause_switches').select('*').order('scope')) as PauseSwitch[];
    },
    setPause: async (scope, value, active, reason) => {
      await rpc('set_pause', { p_scope: scope, p_value: value, p_active: active, p_reason: reason });
    },
    async getSettings() {
      const rows = must(await db.from('system_settings').select('key, value')) as Array<{ key: string; value: unknown }>;
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },
    setSetting: async (key, value) => {
      await rpc('set_setting', { p_key: key, p_value: value });
    },

    seedTestData: async () => {
      await rpc('seed_test_data');
    },
    testSendNow: async () => {
      await rpc('test_send_now');
    },
    resetTestData: async (confirm) => {
      await rpc('reset_test_data', { p_confirm: confirm });
    },
    goLive: async (confirm) => {
      await rpc('go_live', { p_confirm: confirm });
    },

    setTemplateSample: async (division, value) => {
      await rpc('set_template_sample', { p_division: division, p_value: value });
    },
    listStaff: () => rpc<StaffMember[]>('list_staff'),
    async inviteStaff(email, role) {
      const { data } = await db.auth.getSession();
      if (!data.session) throw new Error('Please sign in again.');
      const response = await fetch(`${url}/functions/v1/staff-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ email, role }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? 'The invite could not be sent.');
      return json as { status: 'invited' | 'added'; email: string };
    },
    setStaffRole: async (userId, role) => {
      await rpc('set_staff_role', { p_user: userId, p_role: role });
    },
    removeStaff: async (userId) => {
      await rpc('remove_staff', { p_user: userId });
    },

    async listAudit(filters, page, pageSize) {
      const { data, error, count } = await auditQuery(filters).range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as AuditEntry[], total: count ?? 0 };
    },
    async exportAudit(filters) {
      await rpc('log_audit_export', { p_search: JSON.stringify(filters) });
      return must(await auditQuery(filters).limit(10000)) as AuditEntry[];
    },

    reviewLoad: (token) => callReview({ token, action: 'view' }),
    reviewDecide: (token, action, versionHash, notes) => callReview({ token, action, version_hash: versionHash, notes }),
  };
}
