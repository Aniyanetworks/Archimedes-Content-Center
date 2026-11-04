import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Collapse, Group, Pagination, Paper, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { type Icon as TablerIcon, IconAlertTriangle, IconBuildingStore, IconCalendarCheck, IconChecks, IconClockPause, IconFilter, IconHourglass, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { CAMPAIGN_STATUSES, type CampaignFilters, type DashboardCards } from '../api/types';
import { CampaignTable } from '../components/CampaignTable';
import { PageHeader } from '../components/PageHeader';
import { formatDate, humanize } from '../lib/util';
import { useAuth } from './AuthContext';

const PAGE_SIZE = 50;

function StatTile({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: TablerIcon; color: string }) {
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <div>
          <Text size="xs" fw={500} c="dimmed">{label}</Text>
          <div className="stat-value">{value}</div>
        </div>
        <ThemeIcon variant="light" color={color} size={36} radius={10} aria-hidden="true">
          <Icon size={19} stroke={1.75} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

function CampaignFlow({ cards }: { cards: DashboardCards }) {
  const parts = [
    { label: 'Awaiting client review', count: cards.pending_approvals, color: 'var(--status-review)' },
    { label: 'Scheduled', count: cards.scheduled, color: 'var(--status-scheduled)' },
    { label: 'Sent', count: cards.sent, color: 'var(--status-sent)' },
    { label: 'Held', count: cards.held, color: 'var(--status-held)' },
    { label: 'Failed', count: cards.failed, color: 'var(--status-failed)' },
  ];
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  const attention = cards.held + cards.failed;
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm" gap="xs">
        <Title order={4}>Campaign status</Title>
        <Text size="sm" c="dimmed">
          {total === 0 ? 'No campaigns yet' : attention > 0 ? `${attention} of ${total} need attention` : `${total} campaigns, none need attention`}
        </Text>
      </Group>
      {total > 0 && (
        <div className="flow-bar" role="img" aria-label={parts.map((part) => `${part.label}: ${part.count}`).join(', ')}>
          {parts.filter((part) => part.count > 0).map((part) => (
            <Tooltip key={part.label} label={`${part.label}: ${part.count}`}>
              <div className="flow-segment" style={{ flexGrow: part.count, background: part.color }} />
            </Tooltip>
          ))}
        </div>
      )}
      <Group gap="lg" mt="sm">
        {parts.map((part) => (
          <Group key={part.label} gap={6} wrap="nowrap">
            <span className="flow-dot" style={{ background: part.color }} />
            <Text size="xs" c="dimmed">{part.label}</Text>
            <Text size="xs" fw={600}>{part.count}</Text>
          </Group>
        ))}
      </Group>
    </Paper>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [filters, setFilters] = useState<CampaignFilters>({});
  const [page, setPage] = useState(0);
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);

  const cards = useQuery({ queryKey: ['cards', filters], queryFn: () => api.dashboardCards(filters) });
  const campaigns = useQuery({ queryKey: ['campaigns', filters, page], queryFn: () => api.listCampaigns(filters, page, PAGE_SIZE) });
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: api.listTenants });
  const editions = useQuery({ queryKey: ['editions'], queryFn: api.listEditions });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const pauses = useQuery({ queryKey: ['pauses'], queryFn: api.listPauses });

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
  const activeFilters = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);
  const value = cards.data;

  return (
    <Stack gap="md">
      <PageHeader
        title="Operations dashboard"
        description="Every tenant campaign, from approval through to sending."
        actions={
          <Group gap={8} wrap="nowrap">
            <span className="live-dot" />
            <Text size="xs" c="dimmed">Updates automatically</Text>
          </Group>
        }
      />

      {activePauses.length > 0 && (
        <Alert color="orange" title="Sending is paused for part of the system" icon={<IconClockPause size={18} />}>
          {activePauses.map((pause) => `${humanize(pause.scope)}${pause.scope_value === '*' ? '' : `: ${pause.scope_value}`}`).join(', ')}.{' '}
          <Text component={Link} to="/admin/controls" size="sm" td="underline" c="inherit">Review pause switches</Text>
        </Alert>
      )}
      {cards.error && <Alert color="red" title="Could not load the dashboard">{(cards.error as Error).message}</Alert>}

      <SimpleGrid cols={{ base: 2, sm: 3, xl: 6 }} spacing="sm">
        <StatTile label="Active tenants" value={value?.active_tenants ?? '—'} icon={IconBuildingStore} color="gray" />
        <StatTile label="Pending approvals" value={value?.pending_approvals ?? '—'} icon={IconHourglass} color="grape" />
        <StatTile label="Scheduled" value={value?.scheduled ?? '—'} icon={IconCalendarCheck} color="brand" />
        <StatTile label="Sent" value={value?.sent ?? '—'} icon={IconChecks} color="teal" />
        <StatTile label="Held" value={value?.held ?? '—'} icon={IconClockPause} color="orange" />
        <StatTile label="Failed" value={value?.failed ?? '—'} icon={IconAlertTriangle} color="red" />
      </SimpleGrid>

      {value && <CampaignFlow cards={value} />}

      <Paper withBorder className="stat-strip">
        <div><Text size="xs" c="dimmed">Upcoming editions</Text><Text fw={600}>{value?.upcoming_editions ?? '—'}</Text></div>
        <div><Text size="xs" c="dimmed">Recipients scheduled</Text><Text fw={600}>{value?.scheduled_recipients ?? '—'}</Text></div>
        <div><Text size="xs" c="dimmed">Unsubscribed or invalid</Text><Text fw={600}>{value?.unsubscribed_invalid ?? '—'}</Text></div>
        <div><Text size="xs" c="dimmed">Cost estimate</Text><Text fw={600}>{value?.cost_estimate_usd == null ? 'Rate not set' : `$${value.cost_estimate_usd.toFixed(2)}`}</Text></div>
      </Paper>

      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm" gap="xs">
          <div>
            <Title order={4}>Campaigns</Title>
            <Text size="xs" c="dimmed">{total} {total === 1 ? 'campaign' : 'campaigns'}{activeFilters > 0 ? ' match your filters' : ''}</Text>
          </div>
          <Group gap="xs">
            {activeFilters > 0 && (
              <Button variant="subtle" color="gray" size="xs" leftSection={<IconX size={14} />} onClick={() => { setFilters({}); setPage(0); }}>Clear filters</Button>
            )}
            <Button
              variant="default"
              size="xs"
              leftSection={<IconFilter size={14} />}
              rightSection={activeFilters > 0 ? <Badge size="xs" circle>{activeFilters}</Badge> : undefined}
              aria-expanded={filtersOpen}
              onClick={toggleFilters}
            >
              Filters
            </Button>
          </Group>
        </Group>

        <Collapse in={filtersOpen}>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="xs" mb="md">
            <Select label="Division" clearable value={filters.division ?? null} onChange={set('division')} data={[{ value: 'hsg', label: 'Home ServiceGenius' }, { value: 'hospitality', label: 'Hospitality' }]} />
            <Select label="Industry" clearable searchable value={filters.industry ?? null} onChange={set('industry')} data={(industries.data ?? []).map((i) => ({ value: i.key, label: i.label }))} />
            <Select label="Plan" clearable value={filters.plan_key ?? null} onChange={set('plan_key')} data={(plans.data ?? []).map((p) => ({ value: p.plan_key, label: p.label }))} />
            <Select label="Tenant" clearable searchable value={filters.tenant_id ?? null} onChange={set('tenant_id')} data={(tenants.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            <Select label="Edition" clearable searchable value={filters.edition_id ?? null} onChange={set('edition_id')} data={(editions.data ?? []).map((e) => ({ value: e.id, label: `${formatDate(e.publication_week)} · ${e.industry} · ${e.subject || 'Untitled'}` }))} />
            <TextInput label="Send date" type="date" value={filters.send_date ?? ''} onChange={(event) => set('send_date')(event.currentTarget.value)} />
            <Select label="Approval mode" clearable value={filters.review_mode ?? null} onChange={set('review_mode')} data={[{ value: 'auto', label: 'Automatic' }, { value: 'review', label: 'Review' }]} />
            <Select label="Status" clearable searchable value={filters.status ?? null} onChange={set('status')} data={CAMPAIGN_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          </SimpleGrid>
        </Collapse>

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
