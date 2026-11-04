import { useState } from 'react';
import { Alert, Button, Group, Pagination, Paper, ScrollArea, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { downloadCsv, formatDateTime, humanize, showError } from '../lib/util';

const PAGE_SIZE = 50;

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(0);
  const audit = useQuery({ queryKey: ['audit', debounced, page], queryFn: () => api.listAudit(debounced, page, PAGE_SIZE) });
  const total = audit.data?.total ?? 0;

  async function exportCsv() {
    try {
      const rows = await api.exportAudit(debounced);
      downloadCsv(`archimedes-audit-${new Date().toISOString().slice(0, 10)}.csv`, rows as unknown as Array<Record<string, unknown>>);
    } catch (error) {
      showError(error);
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Audit log</Title>
        <Button variant="default" onClick={() => void exportCsv()}>Export CSV</Button>
      </Group>
      <TextInput placeholder="Filter by event, for example campaign.status" aria-label="Filter audit log" maw={360} value={search} onChange={(e) => { setSearch(e.currentTarget.value); setPage(0); }} />
      {audit.error && <Alert color="red">{(audit.error as Error).message}</Alert>}
      <Paper withBorder p="sm">
        <ScrollArea>
          <Table striped miw={760}>
            <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Who</Table.Th><Table.Th>Event</Table.Th><Table.Th>Details</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {(audit.data?.rows ?? []).map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.at)}</Table.Td>
                  <Table.Td>{entry.actor}</Table.Td>
                  <Table.Td>{humanize(entry.action)}</Table.Td>
                  <Table.Td><Text size="xs" ff="monospace" lineClamp={2} maw={520}>{JSON.stringify(entry.details)}</Text></Table.Td>
                </Table.Tr>
              ))}
              {!audit.isLoading && total === 0 && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="lg">No audit entries found.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        {total > PAGE_SIZE && <Group justify="center" mt="sm"><Pagination total={Math.ceil(total / PAGE_SIZE)} value={page + 1} onChange={(next) => setPage(next - 1)} /></Group>}
      </Paper>
    </Stack>
  );
}
