import { PageHeader } from '../components/PageHeader';
import { useMemo, useState } from 'react';
import { Alert, Button, Group, Pagination, Paper, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { AUDIT_CATEGORIES, type AuditFilters } from '../api/types';
import { FilterBar } from '../components/FilterBar';
import { downloadCsv, formatDateTime, humanize, showError } from '../lib/util';

const PAGE_SIZE = 50;
const PERIODS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [category, setCategory] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: api.listTenants });

  // The start time is fixed when the period is picked, so the query key stays stable while paging.
  const since = useMemo(() => (period ? new Date(Date.now() - Number(period) * 86_400_000).toISOString() : null), [period]);
  const filters: AuditFilters = { search: debounced, category, tenant_id: tenantId, since };
  const audit = useQuery({ queryKey: ['audit', filters, page], queryFn: () => api.listAudit(filters, page, PAGE_SIZE) });
  const everything = useQuery({ queryKey: ['audit', 'total'], queryFn: () => api.listAudit({}, 0, 1) });
  const total = audit.data?.total ?? 0;
  const tenantName = (id: string | null) => (id ? tenants.data?.find((t) => t.id === id)?.name : undefined);

  // Any filter change goes back to the first page.
  const reset = <T,>(set: (value: T) => void) => (value: T) => { set(value); setPage(0); };
  const clearFilters = () => { setSearch(''); setCategory(null); setTenantId(null); setPeriod(null); setPage(0); };

  async function exportCsv() {
    try {
      const rows = await api.exportAudit(filters);
      downloadCsv(`archimedes-audit-${new Date().toISOString().slice(0, 10)}.csv`, rows as unknown as Array<Record<string, unknown>>);
    } catch (error) {
      showError(error);
    }
  }

  return (
    <Stack>
      <PageHeader title="Audit log" description="A permanent record of sends, approvals and staff actions." actions={<><Button variant="default" onClick={() => void exportCsv()}>Export CSV</Button></>} />
      {audit.error && <Alert color="red">{(audit.error as Error).message}</Alert>}
      <Paper withBorder p="sm">
        <FilterBar
          search={search}
          onSearch={reset(setSearch)}
          searchPlaceholder="Search event or person"
          tabs={AUDIT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          tabsLabel="Filter by type of event"
          tab={category}
          onTab={reset(setCategory)}
          selects={[
            { key: 'tenant', placeholder: 'All sub-accounts', value: tenantId, onChange: reset(setTenantId), data: (tenants.data ?? []).map((t) => ({ value: t.id, label: t.name })) },
            { key: 'period', placeholder: 'Any time', value: period, onChange: reset(setPeriod), data: PERIODS },
          ]}
          total={everything.data?.total ?? 0}
          shown={total}
          noun={['entry', 'entries']}
          onClear={clearFilters}
        />
        <ScrollArea>
          <Table miw={760}>
            <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Who</Table.Th><Table.Th>Event</Table.Th><Table.Th>Details</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {(audit.data?.rows ?? []).map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.at)}</Table.Td>
                  <Table.Td>{entry.actor}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{humanize(entry.action)}</Text>
                    {tenantName(entry.tenant_id) && <Text size="xs" c="dimmed">{tenantName(entry.tenant_id)}</Text>}
                  </Table.Td>
                  <Table.Td><Text size="xs" ff="monospace" lineClamp={2} maw={520}>{JSON.stringify(entry.details)}</Text></Table.Td>
                </Table.Tr>
              ))}
              {!audit.isLoading && total === 0 && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="lg">No entries match these filters.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        {total > PAGE_SIZE && <Group justify="center" mt="sm"><Pagination total={Math.ceil(total / PAGE_SIZE)} value={page + 1} onChange={(next) => setPage(next - 1)} /></Group>}
      </Paper>
    </Stack>
  );
}
