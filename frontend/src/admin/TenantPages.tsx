import { PageHeader } from '../components/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Anchor, Badge, Button, Checkbox, ColorInput, Divider, Group, List, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, TagsInput, Text, Textarea, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { IconCheck, IconTrash, IconX } from '@tabler/icons-react';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { FilterBar } from '../components/FilterBar';
import { hintLabel } from '../components/HintLabel';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { BrandProfile, Cadence, NewsletterPrefs, Tenant } from '../api/types';
import { CampaignTable } from '../components/CampaignTable';
import { canOperate, formatDateTime, humanize, showError, showSuccess } from '../lib/util';
import { useAuth } from './AuthContext';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, i) => ({ value: String(i + 1), label }));
const CADENCE_LABELS: Record<Cadence, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks' };

export function TenantListPage() {
  const { session } = useAuth();
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: api.listTenants });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);

  const all = tenants.data ?? [];
  const sendingState = (t: (typeof all)[number]) => (t.status === 'paused' ? 'paused' : t.live_send_enabled ? 'live' : 'test');
  const sendingTabs = [
    { value: 'live', label: 'Live' },
    { value: 'test', label: 'Test only' },
    { value: 'paused', label: 'Paused' },
  ].map((tab) => ({ ...tab, count: all.filter((t) => sendingState(t) === tab.value).length }));
  // Only offer choices that some sub-account actually has.
  const industryOptions = [...new Set(all.map((t) => t.industry))]
    .map((key) => ({ value: key, label: industries.data?.find((i) => i.key === key)?.label ?? humanize(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const planOptions = [...new Set(all.map((t) => t.plan_key))]
    .map((key) => ({ value: key, label: plans.data?.find((p) => p.plan_key === key)?.label ?? key }));
  const words = search.trim().toLowerCase();
  const rows = all.filter((t) =>
    (!words || `${t.name} ${t.ghl_location_id} ${t.service_areas.join(' ')}`.toLowerCase().includes(words))
    && (!sending || sendingState(t) === sending)
    && (!industry || t.industry === industry)
    && (!plan || t.plan_key === plan)
    && (!mode || (t.review_mode === 'review' ? 'review' : 'auto') === mode));
  const clearFilters = () => { setSearch(''); setSending(null); setIndustry(null); setPlan(null); setMode(null); };

  return (
    <Stack>
      <PageHeader title="Tenants" description="Every sub-account, its plan and whether it can send." actions={<>{canOperate(session?.role) && <Button component={Link} to="/admin/tenants/new">Add tenant</Button>}</>} />
      {tenants.error && <Alert color="red">{(tenants.error as Error).message}</Alert>}
      <Paper withBorder p="sm">
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search name, location ID or area"
          tabs={sendingTabs}
          tabsLabel="Filter by sending"
          tab={sending}
          onTab={setSending}
          selects={[
            { key: 'industry', placeholder: 'All industries', value: industry, onChange: setIndustry, data: industryOptions },
            { key: 'plan', placeholder: 'All plans', value: plan, onChange: setPlan, data: planOptions },
            { key: 'mode', placeholder: 'Any approval', value: mode, onChange: setMode, data: [{ value: 'review', label: 'Owner approves' }, { value: 'auto', label: 'Automatic' }] },
          ]}
          total={all.length}
          shown={rows.length}
          noun={['sub-account', 'sub-accounts']}
          onClear={clearFilters}
        />
        <ScrollArea>
          <Table highlightOnHover miw={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th><Table.Th>Industry</Table.Th><Table.Th>Plan</Table.Th><Table.Th>Cadence</Table.Th><Table.Th>Approval</Table.Th><Table.Th>Sending</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td><Anchor component={Link} to={`/admin/tenants/${t.id}`} fw={600} size="sm">{t.name}</Anchor></Table.Td>
                  <Table.Td>{humanize(t.industry)}</Table.Td>
                  <Table.Td>{plans.data?.find((p) => p.plan_key === t.plan_key)?.label ?? t.plan_key}</Table.Td>
                  <Table.Td>{t.cadence ? CADENCE_LABELS[t.cadence] : '—'}</Table.Td>
                  <Table.Td>{t.review_mode === 'review' ? 'Owner approves' : 'Automatic'}</Table.Td>
                  <Table.Td>
                    {t.status === 'paused' ? <Badge color="orange" variant="light">Paused</Badge>
                      : t.live_send_enabled ? <Badge color="green" variant="light">Live</Badge>
                        : <Badge color="gray" variant="light">Test only</Badge>}
                  </Table.Td>
                </Table.Tr>
              ))}
              {!tenants.isLoading && rows.length === 0 && (
                <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">{all.length ? 'No sub-accounts match these filters.' : 'No sub-accounts yet.'}</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
    </Stack>
  );
}

export function TenantDetailPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['tenant', id], queryFn: () => api.getTenant(id) });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const operate = canOperate(session?.role);
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  const act = async (work: () => Promise<void>, message: string) => {
    try {
      await work();
      showSuccess(message);
      await client.invalidateQueries();
    } catch (error) {
      showError(error);
    }
  };

  if (detail.error) return <Alert color="red" title="Could not load this tenant">{(detail.error as Error).message}</Alert>;
  if (!detail.data) return <Text c="dimmed">Loading…</Text>;
  const { tenant, brand, prefs, plan, campaigns, metrics, events, checklist } = detail.data;
  const template = templates.data?.find((t) => t.key === prefs.template_key);
  const upcoming = campaigns.filter((c) => c.scheduled_at && new Date(c.scheduled_at) > new Date() && !['CANCELED', 'SENT'].includes(c.status)).sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!))[0];
  const last = campaigns.filter((c) => c.status === 'SENT').sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''))[0];
  const ready = checklist.every((item) => item.passed);

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>{tenant.name}</Title>
          <Text c="dimmed" size="sm">{humanize(tenant.industry)} · {plan.label} · {tenant.timezone}</Text>
        </div>
        {operate && (
          <Group gap="xs">
            {campaigns.length === 0 && !tenant.live_send_enabled && (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => setDeleting(true)}>Delete</Button>
            )}
            <Button variant="default" component={Link} to={`/admin/tenants/${id}/edit`}>Edit profile</Button>
          </Group>
        )}
      </Group>
      <ConfirmDelete
        opened={deleting}
        title="Delete this sub-account?"
        message={`${tenant.name} and its brand and newsletter settings will be deleted from Archimedes. Nothing changes in GoHighLevel. This cannot be undone.`}
        confirmLabel="Delete sub-account"
        success={`${tenant.name} deleted`}
        onClose={() => setDeleting(false)}
        onConfirm={() => api.deleteTenant(id)}
        onDone={() => { void client.invalidateQueries({ queryKey: ['tenants'] }); navigate('/admin/tenants', { replace: true }); }}
      />

      {plan.signoff_pending && (
        <Alert color="yellow" title="Plan terms are pending Archimedes signoff">This tenant can run test sends only until the plan's tiers, templates and cadence are confirmed.</Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder p="md">
          <Title order={4} mb="sm">Newsletter</Title>
          <Stack gap={6}>
            <Text size="sm"><b>Title:</b> {brand.newsletter_name || '—'}</Text>
            <Text size="sm"><b>Design:</b> {template ? `${template.name} (v${template.version})` : prefs.template_key ?? '—'}</Text>
            <Text size="sm"><b>Next send:</b> {formatDateTime(upcoming?.scheduled_at, tenant.timezone)}</Text>
            <Text size="sm"><b>Last campaign:</b> {formatDateTime(last?.sent_at, tenant.timezone)}</Text>
            <Text size="sm"><b>Mode:</b> {prefs.review_mode === 'review' ? `Review by ${prefs.reviewer_email ?? 'no reviewer set'}` : 'Automatic'}</Text>
            <Text size="sm"><b>Sender:</b> {brand.from_name} &lt;{brand.from_email ?? 'not set'}&gt; · {brand.sender_verified ? 'verified' : 'not verified'}</Text>
            <Text size="sm"><b>Service areas:</b> {tenant.service_areas.join(', ') || '—'}</Text>
            <Select
              mt="xs"
              label="Cadence"
              maw={240}
              disabled={!operate}
              value={prefs.cadence}
              allowDeselect={false}
              data={plan.allowed_cadences.map((c) => ({ value: c, label: CADENCE_LABELS[c] }))}
              onChange={(value) => value && void act(() => api.changeCadence(id, value as Cadence), 'Cadence updated')}
            />
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Title order={4} mb="sm">Go-live checklist</Title>
          <List spacing={4} size="sm" center>
            {checklist.map((item) => (
              <List.Item
                key={item.item}
                icon={<ThemeIcon size={18} radius="xl" color={item.passed ? 'green' : 'gray'}>{item.passed ? <IconCheck size={12} /> : <IconX size={12} />}</ThemeIcon>}
              >
                {item.label}
              </List.Item>
            ))}
          </List>
          {operate && (
            <Group mt="md">
              {!tenant.test_email_passed_at && (
                <Button variant="default" size="xs" onClick={() => void act(() => api.markTestEmailPassed(id), 'Test email recorded as passed')}>Mark test email passed</Button>
              )}
              <Switch
                label="Live sending"
                checked={tenant.live_send_enabled}
                disabled={!ready && !tenant.live_send_enabled}
                onChange={(event) => { const enabled = event.currentTarget.checked; void act(() => api.setLiveSend(id, enabled), enabled ? 'Live sending enabled' : 'Live sending disabled'); }}
              />
            </Group>
          )}
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md">
        <Title order={4} mb="sm">Campaigns</Title>
        <CampaignTable rows={campaigns} role={session?.role} showTenant={false} />
      </Paper>

      <Paper withBorder p="md">
        <Title order={4} mb="sm">Recent performance</Title>
        {metrics.length === 0 ? <Text c="dimmed" size="sm">No delivery metrics have been recorded yet.</Text> : (
          <ScrollArea>
            <Table miw={600}>
              <Table.Thead><Table.Tr><Table.Th>Campaign</Table.Th><Table.Th>Recipients</Table.Th><Table.Th>Delivered</Table.Th><Table.Th>Opened</Table.Th><Table.Th>Clicked</Table.Th><Table.Th>Bounced</Table.Th><Table.Th>Unsubscribed</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {metrics.map((m) => (
                  <Table.Tr key={m.campaign_id}>
                    <Table.Td>{campaigns.find((c) => c.id === m.campaign_id)?.edition_subject ?? m.campaign_id.slice(0, 8)}</Table.Td>
                    <Table.Td>{m.recipients ?? '—'}</Table.Td><Table.Td>{m.delivered ?? '—'}</Table.Td><Table.Td>{m.opened ?? '—'}</Table.Td><Table.Td>{m.clicked ?? '—'}</Table.Td><Table.Td>{m.bounced ?? '—'}</Table.Td><Table.Td>{m.unsubscribed ?? '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Paper>

      <Paper withBorder p="md">
        <Title order={4} mb="sm">Event history</Title>
        {events.length === 0 ? <Text c="dimmed" size="sm">No events recorded yet.</Text> : (
          <ScrollArea>
            <Table miw={620}>
              <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Who</Table.Th><Table.Th>Event</Table.Th><Table.Th>Details</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {events.map((event) => (
                  <Table.Tr key={event.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(event.at, tenant.timezone)}</Table.Td>
                    <Table.Td>{event.actor}</Table.Td>
                    <Table.Td>{humanize(event.action)}</Table.Td>
                    <Table.Td><Text size="xs" ff="monospace" lineClamp={2} maw={420}>{JSON.stringify(event.details)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Paper>
    </Stack>
  );
}

// Industry and plan are filled from the database once loaded. Timezone starts empty on purpose:
// it sets the send time, so it must be the tenant's, never the staff member's own.
const EMPTY_TENANT: Partial<Tenant> = { name: '', ghl_location_id: '', division: 'hsg', timezone: '', locale: navigator.language || 'en-US', service_areas: [], status: 'active', opted_in: false, entitlement_status: 'active' };
const EMPTY_BRAND: Partial<BrandProfile> = { newsletter_name: '', primary_color: '#1f3a5f', secondary_color: '#c8553d', sender_verified: false, domain_authenticated: false, offer_approved: false, social_links: {} };
const EMPTY_PREFS: Partial<NewsletterPrefs> = { cadence: 'biweekly', preferred_weekday: 4, preferred_local_time: '09:00', review_mode: 'auto', approval_deadline_hours: 24, allowed_segments: [], test_contact_ids: [] };

// Doubles as the onboarding screen until this moves into the Archimedes Onboarding Center.
export function TenantFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['tenant', id], queryFn: () => api.getTenant(id!), enabled: !!id });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });

  const [tenant, setTenant] = useState<Partial<Tenant>>(EMPTY_TENANT);
  const [brand, setBrand] = useState<Partial<BrandProfile>>(EMPTY_BRAND);
  const [prefs, setPrefs] = useState<Partial<NewsletterPrefs>>(EMPTY_PREFS);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    setTenant(detail.data.tenant);
    setBrand(detail.data.brand);
    setPrefs(detail.data.prefs);
    setAcknowledged(!!detail.data.tenant.compliance_acknowledged_at);
  }, [detail.data]);

  const plan = useMemo(() => plans.data?.find((p) => p.plan_key === tenant.plan_key), [plans.data, tenant.plan_key]);

  useEffect(() => {
    if (id || !industries.data || !plans.data) return;
    const firstIndustry = industries.data;
    const firstPlan = plans.data;
    setTenant((current) => ({
      ...current,
      industry: current.industry ?? firstIndustry.find((i) => i.division === current.division)?.key,
      plan_key: current.plan_key ?? firstPlan.find((p) => p.division === current.division)?.plan_key,
    }));
  }, [id, industries.data, plans.data]);
  const allowedTemplates = (templates.data ?? []).filter((t) => plan?.template_keys.includes(t.key));

  // Keep the form valid when the division or plan changes.
  useEffect(() => {
    if (!plan) return;
    setPrefs((current) => ({
      ...current,
      cadence: current.cadence && plan.allowed_cadences.includes(current.cadence) ? current.cadence : plan.default_cadence,
      template_key: current.template_key && plan.template_keys.includes(current.template_key) ? current.template_key : null,
    }));
  }, [plan]);

  const text = <T,>(setter: React.Dispatch<React.SetStateAction<Partial<T>>>, key: keyof T) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setter((current) => ({ ...current, [key]: value === '' ? null : value }));
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = { ...tenant, compliance_acknowledged_at: acknowledged ? tenant.compliance_acknowledged_at ?? new Date().toISOString() : null };
      const saved = await api.saveTenant(payload, brand, prefs);
      showSuccess('Tenant saved');
      await client.invalidateQueries();
      navigate(`/admin/tenants/${saved}`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <Stack>
        <Title order={2}>{id ? `Edit ${tenant.name ?? 'tenant'}` : 'Add tenant'}</Title>

        <Paper withBorder p="md">
          <Title order={4} mb="sm">Business and plan</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={hintLabel("Business name", "The sub-account's business name, as shown in this app.")} placeholder="Ridgeline Roofing" required value={tenant.name ?? ''} onChange={text(setTenant, 'name')} />
            <TextInput label={hintLabel("GHL location ID", "Find it in GoHighLevel under Settings → Business Profile → Location ID. Each location can belong to only one sub-account.")} placeholder="e.g. aBcD1234EfGh5678IjKl" required value={tenant.ghl_location_id ?? ''} onChange={text(setTenant, 'ghl_location_id')} />
            <Select
              label={hintLabel("Division", "Home ServiceGenius or Hospitality. Decides which industries and plans you can pick.")} required allowDeselect={false} value={tenant.division}
              data={[{ value: 'hsg', label: 'Home ServiceGenius' }, { value: 'hospitality', label: 'Hospitality' }]}
              onChange={(value) => {
                const division = value as Tenant['division'];
                const firstIndustry = industries.data?.find((i) => i.division === division)?.key;
                const firstPlan = plans.data?.find((p) => p.division === division)?.plan_key;
                setTenant((current) => ({ ...current, division, industry: firstIndustry, plan_key: firstPlan }));
              }}
            />
            <Select label={hintLabel("Industry", "Decides which weekly newsletter this sub-account gets.")} placeholder="Choose an industry" required allowDeselect={false} value={tenant.industry ?? null} data={(industries.data ?? []).filter((i) => i.division === tenant.division).map((i) => ({ value: i.key, label: i.label }))} onChange={(value) => setTenant((c) => ({ ...c, industry: value ?? undefined }))} />
            <Select label={hintLabel("Plan", "Decides which designs it can use and how often newsletters can go out.")} placeholder="Choose a plan" required allowDeselect={false} value={tenant.plan_key ?? null} data={(plans.data ?? []).filter((p) => p.division === tenant.division).map((p) => ({ value: p.plan_key, label: p.label }))} onChange={(value) => setTenant((c) => ({ ...c, plan_key: value ?? undefined }))} />
            <TextInput label={hintLabel("Timezone", "The sub-account's own timezone, which sets the send time. Use a name like America/Denver.")} placeholder="America/Denver" required value={tenant.timezone ?? ''} onChange={text(setTenant, 'timezone')} />
            <TagsInput label={hintLabel("Service areas", "Region codes such as US-CO. Stories limited to certain regions only go to sub-accounts serving them. Press Enter after each one.")} placeholder="Type a region code, then press Enter (e.g. US-CO)" value={tenant.service_areas ?? []} onChange={(service_areas) => setTenant((c) => ({ ...c, service_areas }))} />
            <Select label={hintLabel("Status", "A paused sub-account gets no newsletters until it is set back to Active.")} allowDeselect={false} value={tenant.status ?? 'active'} data={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }]} onChange={(value) => setTenant((c) => ({ ...c, status: value as Tenant['status'] }))} />
          </SimpleGrid>
          {plan?.signoff_pending && <Alert color="yellow" mt="sm">This plan's commercial terms are not signed off yet, so it stays test-only.</Alert>}
        </Paper>

        <Paper withBorder p="md">
          <Title order={4} mb="sm">Brand</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={hintLabel("Newsletter title", "Shown at the top of every newsletter.")} placeholder="The Ridgeline Home Protection Report" required value={brand.newsletter_name ?? ''} onChange={text(setBrand, 'newsletter_name')} />
            <TextInput label={hintLabel("Logo URL", "A public link to a PNG or JPG logo.")} placeholder="https://yourcompany.com/logo.png" type="url" value={brand.logo_url ?? ''} onChange={text(setBrand, 'logo_url')} />
            <ColorInput label={hintLabel("Main colour", "Used for the header and headings.")} placeholder="#14344F" format="hex" value={brand.primary_color ?? ''} onChange={(primary_color) => setBrand((c) => ({ ...c, primary_color }))} />
            <ColorInput label={hintLabel("Accent colour", "Used for buttons and accents.")} placeholder="#D9822B" format="hex" value={brand.secondary_color ?? ''} onChange={(secondary_color) => setBrand((c) => ({ ...c, secondary_color }))} />
            <TextInput label={hintLabel("Phone", "Shown in the newsletter so readers can call.")} placeholder="(303) 555-0142" value={brand.phone ?? ''} onChange={text(setBrand, 'phone')} />
            <TextInput label={hintLabel("Website", "Linked from the newsletter.")} placeholder="https://yourcompany.com" type="url" value={brand.website ?? ''} onChange={text(setBrand, 'website')} />
            <TextInput label={hintLabel("Booking URL", "Where the newsletter's buttons send readers.")} placeholder="https://yourcompany.com/book" type="url" value={brand.booking_url ?? ''} onChange={text(setBrand, 'booking_url')} />
          </SimpleGrid>
          <Textarea mt="sm" label={hintLabel("Local note", "A short, current message from the business, such as crew availability or a local event.")} placeholder="A short, current update for local readers, such as crew availability or a community event" autosize minRows={2} value={brand.local_note ?? ''} onChange={text(setBrand, 'local_note')} />
        </Paper>

        <Paper withBorder p="md">
          <Title order={4} mb="sm">Sender and compliance</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={hintLabel("Legal business name", "Shown in the email footer, as email law requires.")} placeholder="Ridgeline Roofing & Exteriors LLC" required value={brand.legal_business_name ?? ''} onChange={text(setBrand, 'legal_business_name')} />
            <TextInput label={hintLabel("Postal address", "Required in every email footer by email law.")} placeholder="2150 Market Street, Suite 200, Denver, CO 80205" required value={brand.postal_address ?? ''} onChange={text(setBrand, 'postal_address')} />
            <TextInput label={hintLabel("From name", "The sender name people see in their inbox.")} placeholder="Ridgeline Roofing" value={brand.from_name ?? ''} onChange={text(setBrand, 'from_name')} />
            <TextInput label={hintLabel("From email", "The sender address. It must be on a sending domain verified in GoHighLevel, or emails may be blocked as spam.")} placeholder="news@yourdomain.com" type="email" value={brand.from_email ?? ''} onChange={text(setBrand, 'from_email')} />
            <TextInput label={hintLabel("Reply-to", "Where replies from readers go.")} placeholder="office@yourdomain.com" type="email" value={brand.reply_to ?? ''} onChange={text(setBrand, 'reply_to')} />
            <TextInput label={hintLabel("GHL user ID", "The GoHighLevel user the newsletter is scheduled as. GoHighLevel needs one to schedule emails.")} placeholder="e.g. aBcD1234EfGh5678IjKl" value={prefs.ghl_user_id ?? ''} onChange={text(setPrefs, 'ghl_user_id')} />
          </SimpleGrid>
          <Stack mt="sm" gap="xs">
            <Checkbox label={hintLabel("Sender identity verified in GHL", "Tick only after the From email is verified in GoHighLevel.")} checked={!!brand.sender_verified} onChange={(e) => { const sender_verified = e.currentTarget.checked; setBrand((c) => ({ ...c, sender_verified })); }} />
            <Checkbox label={hintLabel("Sending domain authenticated", "Tick only after the sending domain is authenticated in GoHighLevel. Without it, emails are likely to be blocked as spam.")} checked={!!brand.domain_authenticated} onChange={(e) => { const domain_authenticated = e.currentTarget.checked; setBrand((c) => ({ ...c, domain_authenticated })); }} />
            <Checkbox label={hintLabel("Business has opted in to the newsletter", "The business has agreed to receive the newsletter service.")} checked={!!tenant.opted_in} onChange={(e) => { const opted_in = e.currentTarget.checked; setTenant((c) => ({ ...c, opted_in })); }} />
            <Checkbox label={hintLabel("Business accepted the email rules", "The business has confirmed it follows email rules, such as only emailing people who agreed to it.")} checked={acknowledged} onChange={(e) => setAcknowledged(e.currentTarget.checked)} />
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Title order={4} mb="sm">Newsletter preferences</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label={hintLabel("Design", "Which newsletter design to use. Only designs in the sub-account's plan are listed.")} placeholder="Choose a design"
              description={plan ? `${plan.label} includes ${plan.template_keys.length} of ${templates.data?.length ?? 5} designs` : undefined}
              required
              value={prefs.template_key ?? null}
              data={allowedTemplates.map((t) => ({ value: t.key, label: t.name }))}
              onChange={(template_key) => setPrefs((c) => ({ ...c, template_key }))}
            />
            <Select label={hintLabel("Cadence", "How often newsletters go out: weekly or every two weeks.")} allowDeselect={false} value={prefs.cadence} data={(plan?.allowed_cadences ?? []).map((c) => ({ value: c, label: CADENCE_LABELS[c] }))} onChange={(value) => setPrefs((c) => ({ ...c, cadence: value as Cadence }))} />
            <Select label={hintLabel("Send day", "The day of the week the newsletter goes out.")} allowDeselect={false} value={String(prefs.preferred_weekday ?? 4)} data={WEEKDAYS} onChange={(value) => setPrefs((c) => ({ ...c, preferred_weekday: Number(value) }))} />
            <TextInput label={hintLabel("Send time", "The time it goes out, in the sub-account's own timezone.")} type="time" value={(prefs.preferred_local_time ?? '09:00').slice(0, 5)} onChange={text(setPrefs, 'preferred_local_time')} />
            <TagsInput label={hintLabel("Contact tags", "Only GoHighLevel contacts with these tags get the newsletter. Type a tag ID and press Enter.")} placeholder="Paste a GHL tag ID, then press Enter" value={prefs.allowed_segments ?? []} onChange={(allowed_segments) => setPrefs((c) => ({ ...c, allowed_segments }))} />
            <TagsInput label={hintLabel("Test contacts", "The only people who get it while testing. Type a GoHighLevel contact ID and press Enter.")} placeholder="Paste a GHL contact ID, then press Enter" value={prefs.test_contact_ids ?? []} onChange={(test_contact_ids) => setPrefs((c) => ({ ...c, test_contact_ids }))} />
          </SimpleGrid>
          <Divider my="md" />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label={hintLabel("Approval mode", "Automatic sends without asking. Review emails the owner first so they can approve it.")} allowDeselect={false} value={prefs.review_mode} data={[{ value: 'auto', label: 'Automatic after central approval' }, { value: 'review', label: 'Client reviews before sending' }]} onChange={(value) => setPrefs((c) => ({ ...c, review_mode: value as NewsletterPrefs['review_mode'] }))} />
            <NumberInput label={hintLabel("Approval deadline", "How many hours before the send time the owner must approve. If they miss it, the newsletter is held.")} placeholder="24" min={1} max={168} value={prefs.approval_deadline_hours ?? 24} onChange={(value) => setPrefs((c) => ({ ...c, approval_deadline_hours: Number(value) }))} />
            {prefs.review_mode === 'review' && (
              <>
                <TextInput label={hintLabel("Reviewer name", "The person who approves the newsletter.")} placeholder="Jordan Smith" value={prefs.reviewer_name ?? ''} onChange={text(setPrefs, 'reviewer_name')} />
                <TextInput label={hintLabel("Reviewer email", "Gets the approval link for each newsletter.")} placeholder="owner@yourcompany.com" type="email" required value={prefs.reviewer_email ?? ''} onChange={text(setPrefs, 'reviewer_email')} />
              </>
            )}
          </SimpleGrid>
        </Paper>

        <Paper withBorder p="md">
          <Title order={4} mb="sm">Offer</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={hintLabel("Offer headline", "The offer's title.")} placeholder="Book your pre-winter roof check" value={brand.offer_headline ?? ''} onChange={text(setBrand, 'offer_headline')} />
            <TextInput label={hintLabel("Offer button text", "The text on the offer's button.")} placeholder="Pick a time" value={brand.offer_cta_label ?? ''} onChange={text(setBrand, 'offer_cta_label')} />
            <TextInput label={hintLabel("Offer link", "Where the offer button goes.")} placeholder="https://yourcompany.com/offer" type="url" value={brand.offer_url ?? ''} onChange={text(setBrand, 'offer_url')} />
            <TextInput label={hintLabel("Offer ends on", "The offer stops appearing after this date.")} type="date" value={brand.offer_expires_at?.slice(0, 10) ?? ''} onChange={text(setBrand, 'offer_expires_at')} />
          </SimpleGrid>
          <Textarea mt="sm" label={hintLabel("Offer text", "A sentence or two about the offer.")} placeholder="One or two sentences on the offer. Use only current, verified terms." autosize minRows={2} value={brand.offer_body ?? ''} onChange={text(setBrand, 'offer_body')} />
          <Checkbox mt="sm" label={hintLabel("Offer and terms verified as current", "Tick only after checking the offer is still valid. Unverified or expired offers never appear.")} checked={!!brand.offer_approved} onChange={(e) => { const offer_approved = e.currentTarget.checked; setBrand((c) => ({ ...c, offer_approved })); }} />
        </Paper>

        <Group justify="flex-end">
          <Button variant="default" onClick={() => navigate(-1)}>Discard</Button>
          <Button type="submit" loading={busy}>Save tenant</Button>
        </Group>
      </Stack>
    </form>
  );
}
