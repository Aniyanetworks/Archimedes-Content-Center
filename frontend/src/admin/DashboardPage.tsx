import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, Pagination, Paper, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { CAMPAIGN_STATUSES, type CampaignFilters } from '../api/types';
import { CampaignTable } from '../components/CampaignTable';
import { formatDate, humanize } from '../lib/util';
import { useAuth } from './AuthContext';

const PAGE_SIZE = 50;

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="xl" fw={700} c={tone}>{value}</Text>
    </Paper>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [filters, setFilters] = useState<CampaignFilters>({});
  const [page, setPage] = useState(0);

  const cards = useQuery({ queryKey: ['cards', filters], queryFn: () => api.dashboardCards(filters) });
  const campaigns = useQuery({ queryKey: ['campaigns', filters, page], queryFn: () => api.listCampaigns(filters, page, PAGE_SIZE) });
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: api.listTenants });
  const editions = useQuery({ queryKey: ['editions'], queryFn: api.listEditions });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const pauses = useQuery({ queryKey: ['pauses'], queryFn: api.listPauses });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  // Live status: step 7 of the data flow.
  useEffect(
    () =>
      api.subscribeCampaigns(() => {
        void client.invalidateQueries({ queryKey: ['campaigns'] });
        void client.invalidateQueries({ queryKey: ['cards'] });
      }),
    [client],
  );

  const set = (key: keyof CampaignFilters) => (value: string | null) => {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value || null }));
  };

  const activePauses = pauses.data?.filter((pause) => pause.active) ?? [];
  const total = campaigns.data?.total ?? 0;
  const hasFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);
  const value = cards.data;

  return (
    <Stack>
      <Title order={2}>Operations dashboard</Title>

      {activePauses.length > 0 && (
        <Alert color="orange" title="Sending is paused for part of the system">
          {activePauses.map((pause) => `${humanize(pause.scope)}${pause.scope_value === '*' ? '' : `: ${pause.scope_value}`}`).join(', ')}.{' '}
          <Text component={Link} to="/admin/controls" size="sm" td="underline" c="inherit">Review pause switches</Text>
        </Alert>
      )}
      {settings.data?.safe_test_mode === true && (
        <Alert color="blue" title="Safe test mode is on">Sends can only reach each tenant's test contacts, however the tenant is configured.</Alert>
      )}
      {cards.error && <Alert color="red" title="Could not load the dashboard">{(cards.error as Error).message}</Alert>}

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
        <StatCard label="Active tenants" value={value?.active_tenants ?? '—'} />
        <StatCard label="Upcoming editions" value={value?.upcoming_editions ?? '—'} />
        <StatCard label="Pending approvals" value={value?.pending_approvals ?? '—'} tone={value?.pending_approvals ? 'yellow.7' : undefined} />
        <StatCard label="Scheduled" value={value?.scheduled ?? '—'} />
        <StatCard label="Sent" value={value?.sent ?? '—'} tone="green.7" />
        <StatCard label="Failed" value={value?.failed ?? '—'} tone={value?.failed ? 'red.7' : undefined} />
        <StatCard label="Held" value={value?.held ?? '—'} tone={value?.held ? 'orange.7' : undefined} />
        <StatCard label="Unsubscribed or invalid" value={value?.unsubscribed_invalid ?? '—'} />
        <StatCard label="Recipients scheduled" value={value?.scheduled_recipients ?? '—'} />
        <StatCard label="Cost estimate" value={value?.cost_estimate_usd == null ? 'Rate not set' : `$${value.cost_estimate_usd.toFixed(2)}`} />
      </SimpleGrid>

      <Paper withBorder p="sm">
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="xs">
          <Select label="Division" clearable value={filters.division ?? null} onChange={set('division')} data={[{ value: 'hsg', label: 'Home ServiceGenius' }, { value: 'hospitality', label: 'Hospitality' }]} />
          <Select label="Industry" clearable searchable value={filters.industry ?? null} onChange={set('industry')} data={(industries.data ?? []).map((i) => ({ value: i.key, label: i.label }))} />
          <Select label="Plan" clearable value={filters.plan_key ?? null} onChange={set('plan_key')} data={(plans.data ?? []).map((p) => ({ value: p.plan_key, label: p.label }))} />
          <Select label="Tenant" clearable searchable value={filters.tenant_id ?? null} onChange={set('tenant_id')} data={(tenants.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          <Select label="Edition" clearable searchable value={filters.edition_id ?? null} onChange={set('edition_id')} data={(editions.data ?? []).map((e) => ({ value: e.id, label: `${formatDate(e.publication_week)} · ${e.industry} · ${e.subject || 'Untitled'}` }))} />
          <TextInput label="Send date" type="date" value={filters.send_date ?? ''} onChange={(event) => set('send_date')(event.currentTarget.value)} />
          <Select label="Approval mode" clearable value={filters.review_mode ?? null} onChange={set('review_mode')} data={[{ value: 'auto', label: 'Automatic' }, { value: 'review', label: 'Review' }]} />
          <Select label="Status" clearable searchable value={filters.status ?? null} onChange={set('status')} data={CAMPAIGN_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        </SimpleGrid>
        {hasFilters && (
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" size="xs" onClick={() => { setFilters({}); setPage(0); }}>Clear filters</Button>
          </Group>
        )}
      </Paper>

      <Paper withBorder p="sm">
        {campaigns.error ? (
          <Alert color="red" title="Could not load campaigns">{(campaigns.error as Error).message}</Alert>
        ) : (
          <CampaignTable rows={campaigns.data?.rows ?? []} role={session?.role} />
        )}
        {total > PAGE_SIZE && (
          <Group justify="center" mt="sm">
            <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page + 1} onChange={(next) => setPage(next - 1)} />
          </Group>
        )}
      </Paper>
    </Stack>
  );
}
