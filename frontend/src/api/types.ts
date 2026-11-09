export type Division = 'hsg' | 'hospitality';
export type StaffRole = 'admin' | 'editor' | 'operator';
export type Cadence = 'weekly' | 'biweekly';
export type ReviewMode = 'auto' | 'review';
export type ContentStatus = 'draft' | 'editorial_review' | 'fact_rights_review' | 'approved' | 'rejected' | 'retired';
export type EditionStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';
export type PauseScope = 'global' | 'division' | 'industry' | 'tenant' | 'edition';
export type CampaignStatus =
  | 'NOT_ELIGIBLE' | 'READY_TO_RENDER' | 'RENDERED' | 'CENTRAL_APPROVED'
  | 'AUTO_QUEUED' | 'CLIENT_REVIEW_PENDING' | 'APPROVED_FOR_SEND'
  | 'SCHEDULED' | 'SENDING' | 'SENT'
  | 'REVISION_REQUESTED' | 'REJECTED' | 'HELD' | 'FAILED' | 'CANCELED';

export const CAMPAIGN_STATUSES: CampaignStatus[] = [
  'NOT_ELIGIBLE', 'READY_TO_RENDER', 'RENDERED', 'CENTRAL_APPROVED', 'AUTO_QUEUED', 'CLIENT_REVIEW_PENDING',
  'APPROVED_FOR_SEND', 'SCHEDULED', 'SENDING', 'SENT', 'REVISION_REQUESTED', 'REJECTED', 'HELD', 'FAILED', 'CANCELED',
];

export interface Session {
  email: string;
  role: StaffRole | null;
}

export interface CampaignRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  timezone: string;
  division: Division;
  industry: string;
  plan_key: string;
  review_mode: ReviewMode | null;
  edition_id: string;
  edition_subject: string;
  publication_week: string;
  edition_version: number;
  status: CampaignStatus;
  status_reason: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  review_deadline: string | null;
  ghl_campaign_id: string | null;
  dispatch_state: string;
  dispatch_attempts: number;
  last_error: string | null;
  rendered_html_hash: string | null;
  idempotency_key: string;
  dead_lettered_at: string | null;
  cancel_requested_at: string | null;
  delivery_state?: 'unchecked' | 'delivered' | 'partial' | 'failed' | 'unverified';
}

export interface CampaignFilters {
  division?: string | null;
  industry?: string | null;
  plan_key?: string | null;
  tenant_id?: string | null;
  edition_id?: string | null;
  send_date?: string | null;
  review_mode?: string | null;
  status?: string | null;
}

export interface DashboardCards {
  active_tenants: number;
  upcoming_editions: number;
  pending_approvals: number;
  scheduled: number;
  sent: number;
  failed: number;
  held: number;
  unsubscribed_invalid: number;
  scheduled_recipients: number;
  cost_estimate_usd: number | null;
}

export type CampaignAction = 'hold' | 'cancel' | 'retry' | 'release' | 'rerender' | 'resend_invite' | 'revoke_approval';

export interface Tenant {
  id: string;
  ghl_location_id: string;
  name: string;
  division: Division;
  industry: string;
  plan_key: string;
  entitlement_status: 'active' | 'suspended' | 'cancelled';
  timezone: string;
  locale: string;
  service_areas: string[];
  status: 'active' | 'paused';
  opted_in: boolean;
  live_send_enabled: boolean;
  test_mode: boolean;
  test_email_passed_at: string | null;
  compliance_acknowledged_at: string | null;
}

export interface BrandProfile {
  tenant_id?: string;
  newsletter_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  legal_business_name: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  sender_verified: boolean;
  domain_authenticated: boolean;
  phone: string | null;
  website: string | null;
  booking_url: string | null;
  postal_address: string | null;
  social_links: Record<string, string>;
  local_note: string | null;
  offer_headline: string | null;
  offer_body: string | null;
  offer_cta_label: string | null;
  offer_url: string | null;
  offer_expires_at: string | null;
  offer_approved: boolean;
}

export interface NewsletterPrefs {
  tenant_id?: string;
  template_key: string | null;
  cadence: Cadence;
  preferred_weekday: number;
  preferred_local_time: string;
  review_mode: ReviewMode;
  reviewer_name: string | null;
  reviewer_email: string | null;
  approval_deadline_hours: number;
  allowed_segments: string[];
  test_contact_ids: string[];
  ghl_user_id: string | null;
}

export interface TenantListRow extends Tenant {
  template_key: string | null;
  cadence: Cadence | null;
  review_mode: ReviewMode | null;
  newsletter_name: string | null;
}

export interface Plan {
  plan_key: string;
  division: Division;
  label: string;
  default_cadence: Cadence;
  allowed_cadences: Cadence[];
  signoff_pending: boolean;
  template_keys: string[];
}

export interface TemplateInfo {
  key: string;
  name: string;
  position: number;
  version: number;
  html: string;
  labels: Record<string, Record<string, string>>;
}

export interface ChecklistItem {
  item: string;
  label: string;
  passed: boolean;
}

export interface MetricRow {
  campaign_id: string;
  recipients: number | null;
  suppressed: number | null;
  delivered: number | null;
  opened: number | null;
  clicked: number | null;
  bounced: number | null;
  unsubscribed: number | null;
}

// Audit events grouped for the filter tabs, by the start of the event name.
export const AUDIT_CATEGORIES = [
  { value: 'campaigns', label: 'Campaigns', prefixes: ['campaign', 'review', 'approval', 'dispatch'] },
  { value: 'editions', label: 'Editions', prefixes: ['edition'] },
  { value: 'stories', label: 'Stories', prefixes: ['content'] },
  { value: 'subaccounts', label: 'Sub-accounts', prefixes: ['tenant'] },
  { value: 'staff', label: 'Staff', prefixes: ['staff'] },
  { value: 'settings', label: 'Settings and system', prefixes: ['settings', 'pause', 'templates', 'system', 'test', 'audit', 'workflow'] },
] as const;

export interface AuditFilters {
  search?: string;
  category?: string | null;
  tenant_id?: string | null;
  since?: string | null; // ISO time; entries at or after it
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  tenant_id: string | null;
  campaign_id: string | null;
  edition_id: string | null;
  details: Record<string, unknown>;
}

export interface TenantDetail {
  tenant: Tenant;
  brand: BrandProfile;
  prefs: NewsletterPrefs;
  plan: Plan;
  campaigns: CampaignRow[];
  metrics: MetricRow[];
  events: AuditEntry[];
  checklist: ChecklistItem[];
}

export interface Industry {
  key: string;
  division: Division;
  label: string;
}

export interface ContentItem {
  id: string;
  content_id: string;
  version: number;
  division: Division;
  industry: string;
  regions: string[];
  season: string | null;
  headline: string;
  teaser: string;
  body: string;
  image_url: string | null;
  image_alt: string | null;
  image_license: string | null;
  cta_class: string | null;
  cta_label: string | null;
  expires_at: string | null;
  status: ContentStatus;
  review_notes: string | null;
  updated_at: string;
}

export interface Edition {
  id: string;
  division: Division;
  industry: string;
  publication_week: string;
  version: number;
  subject: string;
  preview_text: string;
  status: EditionStatus;
  eligible_plans: string[];
  embargo_at: string | null;
  expires_at: string | null;
  central_approved_at: string | null;
  notes: string | null;
  updated_at: string;
}

export interface EditionItem {
  content_item_id: string;
  slot: 'hero' | 'secondary';
  position: number;
}

export interface PauseSwitch {
  id: string;
  scope: PauseScope;
  scope_value: string;
  active: boolean;
  reason: string | null;
  updated_by: string | null;
  updated_at: string;
}

export type Settings = Record<string, unknown>;

export interface ReviewView {
  state: 'pending' | 'decided' | 'closed';
  message?: string;
  campaign_id: string;
  tenant_name: string;
  newsletter_name: string;
  subject: string;
  timezone: string;
  deadline: string | null;
  send_at: string | null;
  version_hash: string;
  html: string;
  decision?: string | null;
}

export type ReviewAction = 'approve' | 'request_changes' | 'skip';

// The email server n8n uses. The password is never sent back to the app.
export interface SmtpConfig {
  credential_id: string;
  host: string;
  port: number;
  user: string;
  secure: boolean;
  updated_at: string;
}

export interface SmtpStatus {
  config?: SmtpConfig | null;
  workflows?: Array<{ id: string; name: string; active: boolean }>;
  test?: { ok: boolean; message: string };
}

export type SmtpRequest =
  | { action: 'status' }
  | { action: 'test' }
  | { action: 'save'; host: string; port: number; user: string; password: string; secure: boolean }
  | { action: 'workflows'; on: boolean };

export interface StaffMember {
  user_id: string;
  email: string;
  role: StaffRole;
  added_at: string;
  last_sign_in_at: string | null;
  invite_pending: boolean;
  is_me: boolean;
}

export interface Api {
  mode: 'demo' | 'live';
  getSession(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  recoveryStatus(): Promise<{ ready: boolean; error: string | null }>;
  onAuthChange(callback: () => void): () => void;

  dashboardCards(filters: CampaignFilters): Promise<DashboardCards>;
  listCampaigns(filters: CampaignFilters, page: number, pageSize: number): Promise<{ rows: CampaignRow[]; total: number }>;
  getCampaignHtml(id: string): Promise<string | null>;
  campaignAction(id: string, action: CampaignAction, reason?: string): Promise<void>;
  subscribeCampaigns(callback: () => void): () => void;

  listTenants(): Promise<TenantListRow[]>;
  deleteTenant(id: string): Promise<void>;
  getTenant(id: string): Promise<TenantDetail>;
  saveTenant(tenant: Partial<Tenant>, brand: Partial<BrandProfile>, prefs: Partial<NewsletterPrefs>): Promise<string>;
  changeCadence(tenantId: string, cadence: Cadence): Promise<void>;
  markTestEmailPassed(tenantId: string): Promise<void>;
  setLiveSend(tenantId: string, enabled: boolean): Promise<void>;

  listPlans(): Promise<Plan[]>;
  listIndustries(): Promise<Industry[]>;
  listTemplates(): Promise<TemplateInfo[]>;

  listContent(): Promise<ContentItem[]>;
  getContent(id: string): Promise<ContentItem>;
  saveContent(item: Partial<ContentItem>): Promise<string>;
  advanceContent(id: string, to: ContentStatus, notes?: string): Promise<void>;
  newContentVersion(id: string): Promise<string>;
  deleteContent(id: string): Promise<void>;

  listEditions(): Promise<Edition[]>;
  getEdition(id: string): Promise<{ edition: Edition; items: EditionItem[] }>;
  saveEdition(edition: Partial<Edition>): Promise<string>;
  setEditionItems(id: string, items: EditionItem[]): Promise<void>;
  submitEdition(id: string): Promise<void>;
  approveEdition(id: string): Promise<void>;
  rejectEdition(id: string, notes: string): Promise<void>;
  deleteEdition(id: string): Promise<void>;

  listPauses(): Promise<PauseSwitch[]>;
  setPause(scope: PauseScope, value: string, active: boolean, reason: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSetting(key: string, value: unknown): Promise<void>;
  seedTestData(): Promise<void>;
  testSendNow(): Promise<void>;
  resetTestData(confirm: string): Promise<void>;
  goLive(confirm: string): Promise<void>;

  setTemplateSample(division: Division, value: unknown | null): Promise<void>;

  smtpSettings(request: SmtpRequest): Promise<SmtpStatus>;

  listStaff(): Promise<StaffMember[]>;
  inviteStaff(email: string, role: StaffRole): Promise<{ status: 'invited' | 'added'; email: string }>;
  setStaffRole(userId: string, role: StaffRole): Promise<void>;
  removeStaff(userId: string): Promise<void>;

  listAudit(filters: AuditFilters, page: number, pageSize: number): Promise<{ rows: AuditEntry[]; total: number }>;
  exportAudit(filters: AuditFilters): Promise<AuditEntry[]>;
  clearAuditLog(confirm: string): Promise<{ removed: number }>;

  reviewLoad(token: string): Promise<ReviewView>;
  reviewDecide(token: string, action: ReviewAction, versionHash: string, notes?: string): Promise<ReviewView>;
}
