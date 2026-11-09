// In-memory stand-in used when no Supabase project is configured. It mirrors the rules of the SQL
// layer closely enough to click through every screen, but it is not the enforcement layer:
// the real gates live in supabase/migrations.
import { renderNewsletter } from '../lib/render.js';
import templatesJson from '../generated/templates.json';
import { AUDIT_CATEGORIES } from './types';
import type {
  Api, AuditEntry, AuditFilters, BrandProfile, CampaignRow, CampaignStatus, ChecklistItem, ContentItem, ContentStatus, Edition, EditionItem,
  Industry, NewsletterPrefs, PauseSwitch, Plan, ReviewAction, ReviewView, Session, Settings, SmtpConfig, StaffMember, StaffRole, TemplateInfo, Tenant,
} from './types';

const templates = templatesJson as unknown as TemplateInfo[];
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const days = (count: number) => new Date(Date.now() + count * 86_400_000).toISOString();

function monday(offsetWeeks = 0): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offsetWeeks * 7);
  return date.toISOString().slice(0, 10);
}

function fakeHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `demo${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const allTemplates = templates.map((t) => t.key);
const plans: Plan[] = [
  { plan_key: 'hsg_essentials', division: 'hsg', label: 'HSG Essentials', default_cadence: 'biweekly', allowed_cadences: ['biweekly'], signoff_pending: false, template_keys: ['protection_report', 'tips_insights'] },
  { plan_key: 'hsg_growth', division: 'hsg', label: 'HSG Growth', default_cadence: 'weekly', allowed_cadences: ['weekly', 'biweekly'], signoff_pending: false, template_keys: allTemplates },
  { plan_key: 'hsg_freedom', division: 'hsg', label: 'HSG Freedom', default_cadence: 'weekly', allowed_cadences: ['weekly', 'biweekly'], signoff_pending: false, template_keys: allTemplates },
  { plan_key: 'hospitality_pilot', division: 'hospitality', label: 'Hospitality (pilot, terms pending)', default_cadence: 'weekly', allowed_cadences: ['weekly', 'biweekly'], signoff_pending: true, template_keys: allTemplates },
];

const industries: Industry[] = [
  { key: 'roofing', division: 'hsg', label: 'Roofing' },
  { key: 'hvac', division: 'hsg', label: 'HVAC' },
  { key: 'generators', division: 'hsg', label: 'Generators' },
  { key: 'electrical', division: 'hsg', label: 'Electrical' },
  { key: 'plumbing', division: 'hsg', label: 'Plumbing' },
  { key: 'brewery', division: 'hospitality', label: 'Brewery' },
];

interface DemoTenant {
  tenant: Tenant;
  brand: BrandProfile;
  prefs: NewsletterPrefs;
}

function demoTenant(
  id: string, name: string, division: Tenant['division'], industry: string, plan_key: string, areas: string[],
  brand: Partial<BrandProfile>, prefs: Partial<NewsletterPrefs>, flags: Partial<Tenant> = {},
): DemoTenant {
  return {
    tenant: {
      id, ghl_location_id: `demo-loc-${id}`, name, division, industry, plan_key, entitlement_status: 'active', timezone: 'America/Denver',
      locale: 'en-US', service_areas: areas, status: 'active', opted_in: true, live_send_enabled: false, test_mode: true,
      test_email_passed_at: null, compliance_acknowledged_at: now(), ...flags,
    },
    brand: {
      tenant_id: id, newsletter_name: `${name} Newsletter`, logo_url: null, primary_color: '#1f3a5f', secondary_color: '#c8553d', legal_business_name: `${name} LLC`,
      from_name: name, from_email: `news@${id}.example.com`, reply_to: `office@${id}.example.com`, sender_verified: true, domain_authenticated: true,
      phone: '(555) 010-0100', website: `https://${id}.example.com`, booking_url: `https://${id}.example.com/book`, postal_address: '100 Example Street, Denver, CO 80202',
      social_links: {}, local_note: null, offer_headline: null, offer_body: null, offer_cta_label: null, offer_url: null, offer_expires_at: null, offer_approved: false, ...brand,
    },
    prefs: {
      tenant_id: id, template_key: 'protection_report', cadence: 'weekly', preferred_weekday: 4, preferred_local_time: '09:00', review_mode: 'auto',
      reviewer_name: null, reviewer_email: null, approval_deadline_hours: 24, allowed_segments: ['demo-tag-newsletter'], test_contact_ids: ['demo-contact-1'], ghl_user_id: 'demo-user', ...prefs,
    },
  };
}

function content(id: string, division: Tenant['division'], industry: string, headline: string, teaser: string, body: string, extra: Partial<ContentItem> = {}): ContentItem {
  return {
    id, content_id: `c-${id}`, version: 1, division, industry, regions: [], season: null, headline, teaser, body, image_url: null, image_alt: null, image_license: null,
    cta_class: 'assessment', cta_label: null, expires_at: null, status: 'approved', review_notes: null, updated_at: now(), ...extra,
  };
}

interface DemoCampaign extends CampaignRow {
  html: string | null;
  invite_sent: boolean;
}

export function createDemoApi(): Api {
  const listeners = new Set<() => void>();
  const authListeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let session: Session | null = null;
  let auditId = 1;
  const staff: Array<Omit<StaffMember, 'is_me'>> = [
    { user_id: uid(), email: 'admin@archimedes.example', role: 'admin', added_at: days(-120), last_sign_in_at: days(-0.1), invite_pending: false },
    { user_id: uid(), email: 'editor@archimedes.example', role: 'editor', added_at: days(-90), last_sign_in_at: days(-2), invite_pending: false },
    { user_id: uid(), email: 'operator@archimedes.example', role: 'operator', added_at: days(-60), last_sign_in_at: days(-5), invite_pending: false },
  ];
  const requireAdmin = () => {
    if (session?.role !== 'admin') throw new Error('Your role does not allow this action');
  };
  const demoEmailWorkflows = [
    { id: 'wf-04', name: 'Archimedes 04 Send review invites', active: false },
    { id: 'wf-05', name: 'Archimedes 05 Hold missed review deadlines', active: false },
    { id: 'wf-09', name: 'Archimedes 09 Operations alerts', active: false },
  ];
  const adminCount = () => staff.filter((s) => s.role === 'admin').length;

  const tenants: DemoTenant[] = [
    demoTenant('equinox', 'Equinox Roofing', 'hsg', 'roofing', 'hsg_growth', ['US-CO'], {
      newsletter_name: 'The Equinox Home Protection Report', primary_color: '#14344f', secondary_color: '#d9822b',
      local_note: 'Our crews are booking fall roof assessments across the service area now, so earlier slots fill first.',
      offer_headline: 'Book a roofing assessment', offer_body: 'Every assessment comes with a written report and photos of anything that needs attention.', offer_cta_label: 'Schedule an assessment', offer_url: 'https://equinox.example.com/book', offer_approved: true,
    }, { review_mode: 'review', reviewer_name: 'Equinox reviewer', reviewer_email: 'reviewer@equinox.example.com' }),
    demoTenant('summit', 'Summit Peak Roofing', 'hsg', 'roofing', 'hsg_essentials', ['US-TX'], {
      newsletter_name: 'Summit Peak Homeowner Tips', primary_color: '#3b2f63', secondary_color: '#1d8a7a', phone: '(555) 010-0222',
    }, { template_key: 'tips_insights', cadence: 'biweekly' }),
    demoTenant('timber', 'Timber Ridge HVAC', 'hsg', 'hvac', 'hsg_freedom', ['US-CO'], {
      newsletter_name: 'Timber Ridge Comfort Guide', primary_color: '#22543d', secondary_color: '#c05621', phone: '(555) 010-0333',
    }, { template_key: 'seasonal_guide' }),
    demoTenant('craft', 'Craft Mountain Brewery', 'hospitality', 'brewery', 'hospitality_pilot', ['US-CO'], {
      newsletter_name: 'The Craft Mountain Taproom', primary_color: '#5b3a1e', secondary_color: '#b7791f', phone: '(555) 010-0444',
      local_note: 'Thank you to everyone who joined the neighborhood cleanup. The next one is on the community board by the bar.',
    }, { template_key: 'premium_magazine', review_mode: 'review', reviewer_name: 'Brewery reviewer', reviewer_email: 'reviewer@craft.example.com' }),
  ];

  const contentItems: ContentItem[] = [
    content('roof-hero', 'hsg', 'roofing', 'What to check on your roof after a storm', 'A ten-minute walk-around from the ground can catch small problems before they become leaks.', 'After strong wind or hail, start with a slow walk around the house. Look for shingles that are missing, curled or lifted at the edges, and for dents in gutters, vents and flashing.\n\nInside, check ceilings and the attic for new water stains. Take dated photos of anything you find, and please do not climb onto a wet or damaged roof.', { cta_label: 'Schedule a roof assessment' }),
    content('roof-gutters', 'hsg', 'roofing', 'Why clean gutters protect more than your roof', 'Blocked gutters push water under shingles and against your foundation. Clearing them twice a year keeps water moving away from the house.', 'Clear gutters in late spring and again after the leaves fall.'),
    content('roof-colorado', 'hsg', 'roofing', 'Colorado homeowners: get ready for freeze-thaw season', 'Water that gets under shingles expands when it freezes. A quick check of flashing and sealant before winter keeps small gaps from growing.', 'Look closely at flashing around chimneys, vents and skylights.', { regions: ['US-CO'] }),
    content('hvac-hero', 'hsg', 'hvac', 'Get your furnace ready before the first cold night', 'A few simple checks now help your system run smoothly all winter.', 'Replace the air filter, test the thermostat, clear anything stored around the furnace, and make sure carbon monoxide detectors have fresh batteries. A professional tune-up checks the parts you cannot see.', { cta_label: 'Book a tune-up' }),
    content('brew-hero', 'hospitality', 'brewery', 'New on tap: our autumn release lineup', 'Three new beers join the taps this month, from a toasty brown ale to a crisp fresh-hop lager.', 'Ask for a tasting flight to try all three side by side. Our bar team is happy to walk you through what makes each one different.', { cta_label: 'See what is on' }),
    content('roof-draft', 'hsg', 'roofing', 'Choosing the right attic ventilation upgrade', 'Ridge vents, soffit vents and attic fans each solve different problems.', 'Draft: comparison of ventilation options, waiting for editor notes.', { status: 'draft' }),
    content('roof-review', 'hsg', 'roofing', 'Ice dams explained, and how to prevent them', 'Ice dams form when heat escapes into the roof and melts snow that refreezes at the edge.', 'Better insulation and ventilation are the long-term fix. Waiting on a fact and rights check.', { status: 'fact_rights_review' }),
  ];

  const editions: Edition[] = [];
  const editionItems = new Map<string, EditionItem[]>();
  const addEdition = (id: string, industry: string, division: Tenant['division'], week: string, subject: string, status: Edition['status'], items: EditionItem[]) => {
    editions.push({
      id, division, industry, publication_week: week, version: 1, subject, preview_text: 'Practical tips for your home this month', status, eligible_plans: [], embargo_at: null, expires_at: null,
      central_approved_at: status === 'approved' ? now() : null, notes: null, updated_at: now(),
    });
    editionItems.set(id, items);
  };
  addEdition('ed-roof', 'roofing', 'hsg', monday(0), 'What to check on your roof after a storm', 'approved', [
    { content_item_id: 'roof-hero', slot: 'hero', position: 0 },
    { content_item_id: 'roof-gutters', slot: 'secondary', position: 1 },
    { content_item_id: 'roof-colorado', slot: 'secondary', position: 2 },
  ]);
  addEdition('ed-hvac', 'hvac', 'hsg', monday(0), 'Get your furnace ready before the first cold night', 'approved', [{ content_item_id: 'hvac-hero', slot: 'hero', position: 0 }]);
  addEdition('ed-brew', 'brewery', 'hospitality', monday(0), 'New on tap: our autumn release lineup', 'approved', [{ content_item_id: 'brew-hero', slot: 'hero', position: 0 }]);
  addEdition('ed-roof-next', 'roofing', 'hsg', monday(1), 'Ice dams explained, and how to prevent them', 'pending_approval', [
    { content_item_id: 'roof-hero', slot: 'hero', position: 0 },
  ]);

  const campaigns: DemoCampaign[] = [];
  const pauses: PauseSwitch[] = [];
  const settings: Settings = {
    environment: 'test', ghl_dry_run: true, safe_test_mode: true, internal_preview_addresses: ['ops@archimedes.example.com'], ops_alert_email: 'ops@archimedes.example.com', daily_send_cap: null, cost_per_1000_emails_usd: null,
  };
  const audit: AuditEntry[] = [];

  function filterAudit(filters: AuditFilters): AuditEntry[] {
    const words = (filters.search ?? '').trim().toLowerCase();
    const category = AUDIT_CATEGORIES.find((c) => c.value === filters.category);
    return audit.filter((entry) =>
      (!words || entry.action.toLowerCase().includes(words) || entry.actor.toLowerCase().includes(words))
      && (!category || (category.prefixes as readonly string[]).includes(entry.action.split('.')[0]))
      && (!filters.tenant_id || entry.tenant_id === filters.tenant_id)
      && (!filters.since || entry.at >= filters.since));
  }

  function log(action: string, details: Record<string, unknown>, ids: Partial<Pick<AuditEntry, 'tenant_id' | 'campaign_id' | 'edition_id'>> = {}) {
    audit.unshift({ id: auditId++, at: now(), actor: session?.email ?? 'system', action, tenant_id: null, campaign_id: null, edition_id: null, details, ...ids });
  }

  function renderFor(t: DemoTenant, edition: Edition): { html: string | null; subject: string; errors: string[] } {
    const items = (editionItems.get(edition.id) ?? [])
      .map((item) => ({ ...item, story: contentItems.find((c) => c.id === item.content_item_id)! }))
      .filter(({ story }) => story && (story.regions.length === 0 || story.regions.some((r) => t.tenant.service_areas.includes(r))));
    const template = templates.find((tpl) => tpl.key === t.prefs.template_key) ?? templates[0];
    const hero = items.find((i) => i.slot === 'hero')?.story;
    const result = renderNewsletter({
      template_html: template.html,
      labels: template.labels,
      division: t.tenant.division,
      edition,
      tenant: t.tenant,
      brand: t.brand,
      hero,
      secondary: items.filter((i) => i.slot === 'secondary').map((i) => i.story),
      offer: t.brand.offer_approved && t.brand.offer_headline
        ? { headline: t.brand.offer_headline, body: t.brand.offer_body, cta_label: t.brand.offer_cta_label, url: t.brand.offer_url }
        : null,
    });
    return { html: result.html, subject: result.subject ?? edition.subject, errors: result.errors };
  }

  function sendAt(t: DemoTenant, week: string): string {
    const date = new Date(`${week}T15:00:00Z`);
    date.setUTCDate(date.getUTCDate() + t.prefs.preferred_weekday - 1);
    return date.toISOString();
  }

  function createCampaign(t: DemoTenant, edition: Edition, status: CampaignStatus, extra: Partial<DemoCampaign> = {}): DemoCampaign {
    const rendered = renderFor(t, edition);
    const scheduled = sendAt(t, edition.publication_week);
    const campaign: DemoCampaign = {
      id: uid(), tenant_id: t.tenant.id, tenant_name: t.tenant.name, timezone: t.tenant.timezone, division: t.tenant.division, industry: t.tenant.industry, plan_key: t.tenant.plan_key,
      review_mode: t.prefs.review_mode, edition_id: edition.id, edition_subject: edition.subject, publication_week: edition.publication_week, edition_version: edition.version, status, status_reason: null,
      scheduled_at: scheduled, sent_at: null, review_deadline: t.prefs.review_mode === 'review' ? new Date(new Date(scheduled).getTime() - t.prefs.approval_deadline_hours * 3_600_000).toISOString() : null,
      ghl_campaign_id: null, dispatch_state: 'none', dispatch_attempts: 0, last_error: null, rendered_html_hash: rendered.html ? fakeHash(rendered.html) : null,
      idempotency_key: `${t.tenant.id}:${edition.id}:default`, dead_lettered_at: null, cancel_requested_at: null, html: rendered.html, invite_sent: status === 'CLIENT_REVIEW_PENDING', ...extra,
    };
    campaigns.push(campaign);
    log('campaign.created', { status }, { tenant_id: t.tenant.id, campaign_id: campaign.id, edition_id: edition.id });
    return campaign;
  }

  function byId<T extends { id: string }>(list: T[], id: string): T {
    const found = list.find((item) => item.id === id);
    if (!found) throw new Error('Not found');
    return found;
  }
  const tenantById = (id: string) => {
    const found = tenants.find((t) => t.tenant.id === id);
    if (!found) throw new Error('Tenant not found');
    return found;
  };
  const editionById = (id: string) => byId(editions, id);

  // Seed one campaign per state worth showing.
  const [equinox, summit, timber, craft] = tenants;
  const roof = editionById('ed-roof');
  createCampaign(equinox, roof, 'CLIENT_REVIEW_PENDING', { review_deadline: days(1), scheduled_at: days(2) });
  createCampaign(summit, roof, 'SCHEDULED', { ghl_campaign_id: 'dry-run-001', dispatch_state: 'done', dispatch_attempts: 1, scheduled_at: days(2) });
  createCampaign(timber, editionById('ed-hvac'), 'FAILED', { last_error: 'GHL 503 while scheduling. Campaign state reconciled: not scheduled, safe to retry.', dispatch_state: 'retry_safe', dispatch_attempts: 2, scheduled_at: days(1) });
  createCampaign(craft, editionById('ed-brew'), 'HELD', { status_reason: 'review_deadline_missed', review_deadline: days(-1), scheduled_at: days(1) });
  createCampaign(equinox, { ...roof, id: 'ed-roof', subject: 'Five signs your gutters need attention', publication_week: monday(-1) }, 'SENT', {
    idempotency_key: 'equinox:ed-roof-last:default', sent_at: days(-5), scheduled_at: days(-5), ghl_campaign_id: 'dry-run-000', dispatch_state: 'done',
  });

  function checklist(t: DemoTenant): ChecklistItem[] {
    const { tenant, brand, prefs } = t;
    const plan = plans.find((p) => p.plan_key === tenant.plan_key)!;
    return [
      { item: 'identity', label: 'Business identity and legal name', passed: !!brand.legal_business_name },
      { item: 'postal', label: 'Postal address on file', passed: !!brand.postal_address },
      { item: 'sender', label: 'Verified sender identity', passed: brand.sender_verified && !!brand.from_email },
      { item: 'domain', label: 'Sending domain authenticated', passed: brand.domain_authenticated },
      { item: 'title', label: 'Newsletter title set', passed: !!brand.newsletter_name },
      { item: 'template', label: 'Template allowed by plan', passed: !!prefs.template_key && plan.template_keys.includes(prefs.template_key) },
      { item: 'reviewer', label: 'Reviewer set (review mode only)', passed: prefs.review_mode !== 'review' || !!prefs.reviewer_email },
      { item: 'segment', label: 'Contact segment selected', passed: prefs.allowed_segments.length > 0 },
      { item: 'ghl_user', label: 'GHL user id set', passed: !!prefs.ghl_user_id },
      { item: 'opt_in', label: 'Tenant opted in', passed: tenant.opted_in },
      { item: 'compliance', label: 'Compliance acknowledged', passed: !!tenant.compliance_acknowledged_at },
      { item: 'plan_terms', label: 'Plan terms signed off', passed: !plan.signoff_pending },
      { item: 'test_email', label: 'Test email passed', passed: !!tenant.test_email_passed_at },
    ];
  }

  function matches(row: CampaignRow, filters: Record<string, unknown>): boolean {
    for (const key of ['division', 'industry', 'plan_key', 'tenant_id', 'edition_id', 'review_mode', 'status'] as const) {
      if (filters[key] && row[key] !== filters[key]) return false;
    }
    if (filters.send_date && row.scheduled_at?.slice(0, 10) !== filters.send_date) return false;
    return true;
  }

  function setStatus(c: DemoCampaign, to: CampaignStatus, reason: string | null) {
    log('campaign.status', { from: c.status, to, reason }, { tenant_id: c.tenant_id, campaign_id: c.id, edition_id: c.edition_id });
    c.status = to;
    c.status_reason = reason;
  }

  function reviewView(c: DemoCampaign, state: ReviewView['state'], message?: string, decision?: string): ReviewView {
    const t = tenantById(c.tenant_id);
    return {
      state, message, decision, campaign_id: c.id, tenant_name: t.tenant.name, newsletter_name: t.brand.newsletter_name, subject: c.edition_subject, timezone: t.tenant.timezone,
      deadline: c.review_deadline, send_at: c.scheduled_at, version_hash: c.rendered_html_hash ?? '', html: c.html ?? '',
    };
  }

  const reviewToken = (token: string) => {
    const pending = campaigns.find((c) => c.status === 'CLIENT_REVIEW_PENDING');
    if (token === 'demo') {
      if (pending) return pending;
      const decided = audit.find((entry) => entry.action === 'review.decision');
      if (decided?.campaign_id) return byId(campaigns, decided.campaign_id);
    }
    throw new Error('This review link is invalid or has expired.');
  };

  const demo: Api = {
    mode: 'demo',

    async getSession() {
      return session;
    },
    async signIn(email) {
      const role = (['admin', 'editor', 'operator'] as StaffRole[]).find((r) => email.startsWith(r)) ?? 'admin';
      session = { email, role };
      authListeners.forEach((listener) => listener());
    },
    async signOut() {
      session = null;
      authListeners.forEach((listener) => listener());
    },
    async requestPasswordReset() {
      // Demo mode has no email, so this only shows the confirmation screen.
    },
    async updatePassword() {
      throw new Error('Password reset needs a connected Supabase project.');
    },
    async recoveryStatus() {
      return { ready: false, error: 'Password reset needs a connected Supabase project.' };
    },
    onAuthChange(callback) {
      authListeners.add(callback);
      return () => authListeners.delete(callback);
    },

    async dashboardCards(filters) {
      const rows = campaigns.filter((c) => matches(c, filters as Record<string, unknown>));
      const count = (...statuses: CampaignStatus[]) => rows.filter((c) => statuses.includes(c.status)).length;
      return {
        active_tenants: tenants.filter((t) => t.tenant.status === 'active' && t.tenant.entitlement_status === 'active').length,
        upcoming_editions: editions.filter((e) => e.publication_week >= monday(0)).length,
        pending_approvals: count('CLIENT_REVIEW_PENDING'),
        scheduled: count('SCHEDULED', 'SENDING'),
        sent: count('SENT'),
        failed: count('FAILED'),
        held: count('HELD'),
        unsubscribed_invalid: 0,
        scheduled_recipients: 0,
        cost_estimate_usd: null,
      };
    },
    async listCampaigns(filters, page, pageSize) {
      const rows = campaigns
        .filter((c) => matches(c, filters as Record<string, unknown>))
        .sort((a, b) => (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? ''));
      return { rows: rows.slice(page * pageSize, page * pageSize + pageSize), total: rows.length };
    },
    async getCampaignHtml(id) {
      return byId(campaigns, id).html;
    },
    async campaignAction(id, action, reason) {
      const c = byId(campaigns, id);
      const t = tenantById(c.tenant_id);
      switch (action) {
        case 'hold':
          setStatus(c, 'HELD', reason ?? 'operator_hold');
          break;
        case 'cancel':
          if (c.status === 'SCHEDULED') c.cancel_requested_at = now();
          setStatus(c, 'CANCELED', reason ?? 'operator_cancel');
          break;
        case 'retry':
          if (c.dispatch_state === 'unknown') throw new Error('Prior send outcome is unknown. Reconcile with GHL before retrying.');
          c.last_error = null;
          c.dispatch_state = 'retry_safe';
          setStatus(c, 'APPROVED_FOR_SEND', 'operator_retry');
          break;
        case 'release':
          setStatus(c, t.prefs.review_mode === 'review' ? 'CLIENT_REVIEW_PENDING' : 'AUTO_QUEUED', 'operator_release');
          if (t.prefs.review_mode === 'review') c.review_deadline = days(1);
          break;
        case 'rerender': {
          const edition = editionById(c.edition_id);
          const rendered = renderFor(t, edition);
          c.html = rendered.html;
          c.rendered_html_hash = rendered.html ? fakeHash(rendered.html + Date.now()) : null;
          setStatus(c, t.prefs.review_mode === 'review' ? 'CLIENT_REVIEW_PENDING' : 'AUTO_QUEUED', 'operator_rerender');
          log('approval.invalidated', { reason: 'rerender' }, { tenant_id: c.tenant_id, campaign_id: c.id });
          break;
        }
        case 'resend_invite':
          log('review.invite_requested', {}, { tenant_id: c.tenant_id, campaign_id: c.id });
          break;
        case 'revoke_approval':
          log('approval.revoked', { reason }, { tenant_id: c.tenant_id, campaign_id: c.id });
          setStatus(c, 'HELD', 'approval_revoked');
          break;
      }
      notify();
    },
    subscribeCampaigns(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    async listTenants() {
      return tenants.map((t) => ({
        ...t.tenant, template_key: t.prefs.template_key, cadence: t.prefs.cadence, review_mode: t.prefs.review_mode, newsletter_name: t.brand.newsletter_name,
      }));
    },
    async getTenant(id) {
      const t = tenantById(id);
      return {
        tenant: t.tenant, brand: t.brand, prefs: t.prefs, plan: plans.find((p) => p.plan_key === t.tenant.plan_key)!,
        campaigns: campaigns.filter((c) => c.tenant_id === id), metrics: [], events: audit.filter((e) => e.tenant_id === id), checklist: checklist(t),
      };
    },
    async saveTenant(tenant, brand, prefs) {
      if (tenant.id) {
        const existing = tenantById(tenant.id);
        Object.assign(existing.tenant, tenant);
        Object.assign(existing.brand, brand);
        Object.assign(existing.prefs, prefs);
        log('tenant.updated', { fields: Object.keys({ ...tenant, ...brand, ...prefs }) }, { tenant_id: tenant.id });
        notify();
        return tenant.id;
      }
      const id = uid();
      tenants.push(demoTenant(id, tenant.name ?? 'New tenant', tenant.division ?? 'hsg', tenant.industry ?? 'roofing', tenant.plan_key ?? 'hsg_essentials', tenant.service_areas ?? [], brand, prefs, { ...tenant, id }));
      log('tenant.created', {}, { tenant_id: id });
      return id;
    },
    async changeCadence(tenantId, cadence) {
      const t = tenantById(tenantId);
      const plan = plans.find((p) => p.plan_key === t.tenant.plan_key)!;
      if (!plan.allowed_cadences.includes(cadence)) throw new Error('That cadence is not allowed on this plan.');
      log('tenant.cadence_changed', { from: t.prefs.cadence, to: cadence }, { tenant_id: tenantId });
      t.prefs.cadence = cadence;
    },
    async markTestEmailPassed(tenantId) {
      tenantById(tenantId).tenant.test_email_passed_at = now();
      log('tenant.test_email_passed', {}, { tenant_id: tenantId });
    },
    async setLiveSend(tenantId, enabled) {
      const t = tenantById(tenantId);
      if (enabled && checklist(t).some((item) => !item.passed)) throw new Error('Finish the go-live checklist first.');
      t.tenant.live_send_enabled = enabled;
      t.tenant.test_mode = !enabled;
      log('tenant.live_send', { enabled }, { tenant_id: tenantId });
    },

    listPlans: async () => plans,
    listIndustries: async () => industries,
    listTemplates: async () => templates,

    listContent: async () => [...contentItems].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    getContent: async (id) => byId(contentItems, id),
    async saveContent(item) {
      if (item.id) {
        const existing = byId(contentItems, item.id);
        if (existing.status !== 'draft') throw new Error('Only drafts can be edited. Create a new version instead.');
        Object.assign(existing, item, { updated_at: now() });
        return existing.id;
      }
      const id = uid();
      contentItems.push(content(id, item.division ?? 'hsg', item.industry ?? 'roofing', item.headline ?? '', item.teaser ?? '', item.body ?? '', { ...item, id, status: 'draft' }));
      log('content.created', { id });
      return id;
    },
    async advanceContent(id, to: ContentStatus, notes) {
      const item = byId(contentItems, id);
      log('content.status', { from: item.status, to, notes, content: id });
      item.status = to;
      item.review_notes = notes ?? item.review_notes;
      item.updated_at = now();
    },
    async deleteContent(id) {
      if (session?.role !== 'admin' && session?.role !== 'editor') throw new Error('Your role does not allow this action');
      const item = byId(contentItems, id);
      if (item.status === 'approved' || item.status === 'retired') throw new Error('An approved story cannot be deleted. Retire it instead.');
      if ([...editionItems.values()].some((list) => list.some((i) => i.content_item_id === id))) throw new Error('This story is used in an edition. Remove it from the edition first.');
      contentItems.splice(contentItems.indexOf(item), 1);
      log('content.deleted', { headline: item.headline, version: item.version });
    },
    async deleteTenant(id) {
      if (session?.role !== 'admin' && session?.role !== 'operator') throw new Error('Your role does not allow this action');
      const index = tenants.findIndex((t) => t.tenant.id === id);
      if (index < 0) throw new Error('This sub-account no longer exists.');
      const t = tenants[index].tenant;
      if (t.live_send_enabled) throw new Error('Turn off live sending before deleting this sub-account.');
      if (campaigns.some((c) => c.tenant_id === id)) throw new Error('This sub-account already has newsletters, so it cannot be deleted. Pause it instead.');
      tenants.splice(index, 1);
      log('tenant.deleted', { name: t.name }, { tenant_id: id });
    },
    async newContentVersion(id) {
      const source = byId(contentItems, id);
      const newId = uid();
      contentItems.push({ ...source, id: newId, version: source.version + 1, status: 'draft', updated_at: now() });
      log('content.new_version', { from: id, to: newId });
      return newId;
    },

    listEditions: async () => [...editions].sort((a, b) => b.publication_week.localeCompare(a.publication_week)),
    getEdition: async (id) => ({ edition: editionById(id), items: editionItems.get(id) ?? [] }),
    async saveEdition(edition) {
      if (edition.id) {
        const existing = editionById(edition.id);
        const wasApproved = existing.status === 'approved';
        Object.assign(existing, edition, { updated_at: now() });
        if (wasApproved) {
          existing.status = 'draft';
          existing.version += 1;
          existing.central_approved_at = null;
          log('edition.reopened', { reason: 'post_approval_edit' }, { edition_id: existing.id });
        }
        return existing.id;
      }
      if (editions.some((e) => e.industry === (edition.industry ?? 'roofing') && e.publication_week === edition.publication_week)) {
        throw new Error('duplicate key value violates unique constraint "editions_division_industry_publication_week_key"');
      }
      const id = uid();
      editions.push({
        id, division: edition.division ?? 'hsg', industry: edition.industry ?? 'roofing', publication_week: edition.publication_week ?? monday(1), version: 1, subject: edition.subject ?? '',
        preview_text: edition.preview_text ?? '', status: 'draft', eligible_plans: edition.eligible_plans ?? [], embargo_at: edition.embargo_at ?? null, expires_at: edition.expires_at ?? null,
        central_approved_at: null, notes: null, updated_at: now(),
      });
      editionItems.set(id, []);
      return id;
    },
    async setEditionItems(id, items) {
      const edition = editionById(id);
      editionItems.set(id, items);
      if (edition.status === 'approved') {
        edition.status = 'draft';
        edition.version += 1;
        edition.central_approved_at = null;
        log('edition.reopened', { reason: 'items_changed' }, { edition_id: id });
      }
    },
    async submitEdition(id) {
      const items = editionItems.get(id) ?? [];
      if (!items.some((item) => item.slot === 'hero')) throw new Error('Choose a hero story first.');
      if (items.some((item) => byId(contentItems, item.content_item_id).status !== 'approved')) throw new Error('Every story must be approved first.');
      editionById(id).status = 'pending_approval';
      log('edition.submitted', {}, { edition_id: id });
    },
    async approveEdition(id) {
      const edition = editionById(id);
      if (edition.status !== 'pending_approval') throw new Error('Submit the edition for approval first.');
      edition.status = 'approved';
      edition.central_approved_at = now();
      log('edition.approved', { version: edition.version }, { edition_id: id });
      for (const t of tenants) {
        if (t.tenant.division !== edition.division || t.tenant.industry !== edition.industry) continue;
        if (campaigns.some((c) => c.tenant_id === t.tenant.id && c.edition_id === id)) continue;
        createCampaign(t, edition, t.prefs.review_mode === 'review' ? 'CLIENT_REVIEW_PENDING' : 'AUTO_QUEUED');
      }
      notify();
    },
    async rejectEdition(id, notes) {
      const edition = editionById(id);
      edition.status = 'rejected';
      edition.notes = notes;
      log('edition.rejected', { notes }, { edition_id: id });
    },
    async deleteEdition(id) {
      if (session?.role !== 'admin' && session?.role !== 'editor') throw new Error('Your role does not allow this action');
      const edition = editionById(id);
      if (edition.status === 'approved' || edition.central_approved_at || campaigns.some((c) => c.edition_id === id)) {
        throw new Error('An approved edition cannot be deleted. Cancel its campaigns on the dashboard instead.');
      }
      editions.splice(editions.indexOf(edition), 1);
      editionItems.delete(id);
      log('edition.deleted', { industry: edition.industry, week: edition.publication_week, subject: edition.subject }, { edition_id: id });
    },

    listPauses: async () => [...pauses],
    async setPause(scope, value, active, reason) {
      const existing = pauses.find((p) => p.scope === scope && p.scope_value === value);
      if (existing) Object.assign(existing, { active, reason, updated_at: now(), updated_by: session?.email ?? null });
      else pauses.push({ id: uid(), scope, scope_value: value, active, reason, updated_by: session?.email ?? null, updated_at: now() });
      log('pause.set', { scope, value, active, reason });
    },
    getSettings: async () => ({ ...settings }),
    async setSetting(key, value) {
      log('settings.changed', { key, from: settings[key], to: value });
      settings[key] = value;
    },

    async seedTestData() {
      if (tenants.length) throw new Error('Reset first: this project already has data.');
      window.location.reload(); // the sample data is rebuilt on load
    },
    async testSendNow() {
      for (const c of campaigns) {
        if (c.status === 'APPROVED_FOR_SEND') c.scheduled_at = days(0.01);
        if (c.status === 'CLIENT_REVIEW_PENDING') { c.review_deadline = days(0.02); c.scheduled_at = days(0.03); }
      }
      log('test.send_now', {});
      notify();
    },
    async resetTestData(confirm) {
      if (settings.environment !== 'test') throw new Error('A live system cannot be reset.');
      if (confirm !== 'RESET') throw new Error('Type RESET to confirm.');
      for (const list of [tenants, contentItems, editions, campaigns, pauses, audit] as unknown[][]) list.length = 0;
      editionItems.clear();
      settings.ghl_dry_run = true;
      settings.safe_test_mode = true;
      log('test.reset', {});
      notify();
    },
    async goLive(confirm) {
      if (confirm !== 'GO LIVE') throw new Error('Type GO LIVE to confirm.');
      if (tenants.length) throw new Error('Reset the test data before going live.');
      settings.environment = 'production';
      log('system.go_live', {});
    },

    async setTemplateSample(division, value) {
      if (session?.role !== 'admin' && session?.role !== 'editor') throw new Error('Your role does not allow this action');
      settings[`template_sample_${division}`] = value ?? null;
      log(value ? 'templates.example_changed' : 'templates.example_reset', { division });
    },
    async smtpSettings(request) {
      if (session?.role !== 'admin') throw new Error('Only admins can change the email server.');
      const config = settings.smtp_config as SmtpConfig | null | undefined;
      const workflows = () => demoEmailWorkflows.map((w) => ({ ...w }));
      // Demo mode has no n8n: a server name containing "bad" fails the test, anything else passes.
      const test = (host: string) => (host.includes('bad') ? { ok: false, message: 'Connection timed out. Check the server address and port.' } : { ok: true, message: 'Connection successful!' });
      if (request.action === 'status') return { config: config ?? null, workflows: workflows() };
      if (request.action === 'save') {
        if (!request.host.trim()) throw new Error('Enter the server address, for example smtp.gmail.com.');
        if (!request.password) throw new Error('Enter the password.');
        const saved: SmtpConfig = { credential_id: 'demo-smtp', host: request.host.trim(), port: request.port, user: request.user.trim(), secure: request.secure, updated_at: now() };
        settings.smtp_config = saved;
        log('settings.smtp_saved', { host: saved.host, port: saved.port, user: saved.user });
        return { config: saved, test: test(saved.host), workflows: workflows() };
      }
      if (request.action === 'test') {
        if (!config) throw new Error('Save the email server first.');
        return { test: test(config.host) };
      }
      if (request.on && !config) throw new Error('Save the email server first.');
      if (request.on && !String(settings.notification_from_email ?? '').includes('@')) throw new Error('Fill in the Sender email under Notification emails first.');
      for (const w of demoEmailWorkflows) w.active = request.on;
      log(request.on ? 'email_workflows.on' : 'email_workflows.off', {});
      return { workflows: workflows() };
    },
    async listStaff() {
      requireAdmin();
      if (session && !staff.some((s) => s.email === session!.email)) {
        staff.push({ user_id: uid(), email: session.email, role: session.role ?? 'admin', added_at: now(), last_sign_in_at: now(), invite_pending: false });
      }
      return staff.map((s) => ({ ...s, is_me: s.email === session?.email })).sort((a, b) => a.email.localeCompare(b.email));
    },
    async inviteStaff(email, role) {
      requireAdmin();
      const clean = email.trim().toLowerCase();
      if (!/^[^s@]+@[^s@]+.[^s@]+$/.test(clean)) throw new Error('Enter a valid email address.');
      const existing = staff.find((s) => s.email === clean);
      if (existing) {
        existing.role = role;
        log('staff.role_changed', { email: clean, to: role });
        return { status: 'added', email: clean };
      }
      staff.push({ user_id: uid(), email: clean, role, added_at: now(), last_sign_in_at: null, invite_pending: true });
      log('staff.added', { email: clean, to: role });
      return { status: 'invited', email: clean };
    },
    async setStaffRole(userId, role) {
      requireAdmin();
      const member = staff.find((s) => s.user_id === userId);
      if (!member) throw new Error('That user does not exist');
      if (member.role === role) return;
      if (member.role === 'admin' && adminCount() <= 1) throw new Error('There must always be at least one admin');
      log('staff.role_changed', { email: member.email, from: member.role, to: role });
      member.role = role;
      if (member.email === session?.email && session) session = { ...session, role };
    },
    async removeStaff(userId) {
      requireAdmin();
      const index = staff.findIndex((s) => s.user_id === userId);
      if (index < 0) throw new Error('That person is not on the staff list');
      const member = staff[index];
      if (member.email === session?.email) throw new Error('You cannot remove your own access');
      if (member.role === 'admin' && adminCount() <= 1) throw new Error('There must always be at least one admin');
      staff.splice(index, 1);
      log('staff.removed', { email: member.email, role: member.role });
    },

    async listAudit(filters, page, pageSize) {
      const rows = filterAudit(filters);
      return { rows: rows.slice(page * pageSize, page * pageSize + pageSize), total: rows.length };
    },
    async clearAuditLog(confirm) {
      if (session?.role !== 'admin') throw new Error('Your role does not allow this action');
      if (settings.environment !== 'test') throw new Error('The audit log of a live system is permanent and cannot be cleared.');
      if (confirm !== 'CLEAR') throw new Error('Type CLEAR to confirm.');
      const removed = audit.length;
      audit.length = 0;
      log('audit.cleared', { entries_removed: removed });
      return { removed };
    },
    async exportAudit(filters) {
      log('audit.exported', { filters });
      return filterAudit(filters);
    },

    async reviewLoad(token) {
      const c = reviewToken(token);
      if (c.status !== 'CLIENT_REVIEW_PENDING') return reviewView(c, 'decided', 'A decision has already been recorded for this version.');
      return reviewView(c, 'pending');
    },
    async reviewDecide(token, action: ReviewAction, versionHash, notes) {
      const c = reviewToken(token);
      if (c.rendered_html_hash !== versionHash) throw new Error('This newsletter has changed since you opened it. Reload to review the current version.');
      const to: CampaignStatus = action === 'approve' ? 'APPROVED_FOR_SEND' : action === 'request_changes' ? 'REVISION_REQUESTED' : 'CANCELED';
      log('review.decision', { action, notes, version_hash: versionHash }, { tenant_id: c.tenant_id, campaign_id: c.id });
      setStatus(c, to, `reviewer_${action}`);
      notify();
      return reviewView(c, 'decided', 'Your decision has been recorded. Thank you.', action);
    },
  };

  // Hand out copies, like a real API: the page then sees each change as new data and redraws.
  // Without this, a record changed in place looks unchanged and the screen keeps showing the old value.
  // Subscriptions return an unsubscribe function right away, so they are passed through untouched.
  const SUBSCRIPTIONS = new Set(['onAuthChange', 'subscribeCampaigns']);
  const copy = <T,>(value: T): T => (value === undefined || value === null ? value : structuredClone(value));
  return Object.fromEntries(
    Object.entries(demo).map(([key, value]) => [key, typeof value === 'function' && !SUBSCRIPTIONS.has(key) ? async (...args: unknown[]) => copy(await (value as (...a: unknown[]) => unknown)(...args)) : value]),
  ) as unknown as Api;
}
