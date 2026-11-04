import { PageHeader } from '../components/PageHeader';
import { useState } from 'react';
import { Alert, Button, Group, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, TagsInput, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { PauseScope } from '../api/types';
import { canOperate, formatDate, formatDateTime, humanize, showError, showSuccess } from '../lib/util';
import { useAuth } from './AuthContext';
import { TestModePanel } from './TestModePanel';

export function ControlsPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const pauses = useQuery({ queryKey: ['pauses'], queryFn: api.listPauses });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: api.listTenants });
  const editions = useQuery({ queryKey: ['editions'], queryFn: api.listEditions });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const [scope, setScope] = useState<PauseScope>('tenant');
  const [value, setValue] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const operate = canOperate(session?.role);
  const admin = session?.role === 'admin';

  const options: Record<Exclude<PauseScope, 'global'>, Array<{ value: string; label: string }>> = {
    division: [{ value: 'hsg', label: 'Home ServiceGenius' }, { value: 'hospitality', label: 'Hospitality' }],
    industry: (industries.data ?? []).map((i) => ({ value: i.key, label: i.label })),
    tenant: (tenants.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    edition: (editions.data ?? []).map((e) => ({ value: e.id, label: `${formatDate(e.publication_week)} · ${e.industry}` })),
  };

  const labelFor = (pauseScope: PauseScope, scopeValue: string) =>
    pauseScope === 'global' ? 'All sending' : options[pauseScope].find((o) => o.value === scopeValue)?.label ?? scopeValue;

  async function pause(pauseScope: PauseScope, scopeValue: string, active: boolean, why: string) {
    try {
      await api.setPause(pauseScope, scopeValue, active, why);
      showSuccess(active ? 'Pause switched on' : 'Pause switched off');
      setReason('');
      setValue(null);
      await client.invalidateQueries();
    } catch (error) {
      showError(error);
    }
  }

  async function saveSetting(key: string, next: unknown) {
    try {
      await api.setSetting(key, next);
      showSuccess('Setting saved');
      await client.invalidateQueries({ queryKey: ['settings'] });
    } catch (error) {
      showError(error);
    }
  }

  const globalPause = pauses.data?.find((p) => p.scope === 'global' && p.active);
  const active = pauses.data?.filter((p) => p.active) ?? [];
  const canPause = reason.trim() && (scope === 'global' || value);

  return (
    <Stack>
      <PageHeader title="Pause and safety" description="Stop sending at any level, and control test mode and safety settings." />
      {pauses.error && <Alert color="red">{(pauses.error as Error).message}</Alert>}
      {admin && settings.data && <TestModePanel isTest={settings.data.environment === 'test'} />}

      <Paper withBorder p="md">
        <Title order={4} mb="xs">Pause switches</Title>
        <Text size="sm" c="dimmed" mb="sm">A pause stops future dispatches immediately. Queued campaigns resume when the switch comes off. Campaigns already scheduled in GHL are pulled back and held, so an operator must release them.</Text>
        {globalPause && <Alert color="red" mb="sm" title="All sending is paused">{globalPause.reason}</Alert>}
        {operate && (
          <SimpleGrid cols={{ base: 1, sm: 4 }} mb="md">
            <Select label="Level" allowDeselect={false} value={scope} onChange={(next) => { setScope(next as PauseScope); setValue(null); }} data={['global', 'division', 'industry', 'tenant', 'edition'].map((s) => ({ value: s, label: humanize(s) }))} />
            {scope !== 'global' ? <Select label="Target" searchable value={value} onChange={setValue} data={options[scope]} /> : <TextInput label="Target" value="All sending" disabled />}
            <TextInput label="Reason" required value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
            <Button mt={{ base: 0, sm: 25 }} color="orange" disabled={!canPause} onClick={() => void pause(scope, scope === 'global' ? '*' : value!, true, reason.trim())}>Pause</Button>
          </SimpleGrid>
        )}
        <ScrollArea>
          <Table miw={640}>
            <Table.Thead><Table.Tr><Table.Th>Level</Table.Th><Table.Th>Target</Table.Th><Table.Th>Reason</Table.Th><Table.Th>Changed</Table.Th><Table.Th aria-label="Actions" /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {active.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>{humanize(p.scope)}</Table.Td>
                  <Table.Td>{labelFor(p.scope, p.scope_value)}</Table.Td>
                  <Table.Td>{p.reason}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(p.updated_at)}</Table.Td>
                  <Table.Td>{operate && <Button size="xs" variant="default" onClick={() => void pause(p.scope, p.scope_value, false, 'Resumed')}>Resume</Button>}</Table.Td>
                </Table.Tr>
              ))}
              {active.length === 0 && <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" py="md">Nothing is paused.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <Paper withBorder p="md">
        <Title order={4} mb="xs">Safety settings</Title>
        {!admin && <Text size="sm" c="dimmed" mb="sm">Only administrators can change these.</Text>}
        {settings.data && (
          <Stack>
            <Switch disabled={!admin} label="GHL dry run" description="n8n logs what it would do and makes no GHL calls" checked={settings.data.ghl_dry_run === true} onChange={(e) => void saveSetting('ghl_dry_run', e.currentTarget.checked)} />
            <Switch disabled={!admin} label="Safe test mode" description="Every send goes only to each tenant's test contacts" checked={settings.data.safe_test_mode === true} onChange={(e) => void saveSetting('safe_test_mode', e.currentTarget.checked)} />
            <TagsInput disabled={!admin} label="Internal preview addresses" description="Review invites for tenants in test mode go here instead of to the client" value={(settings.data.internal_preview_addresses as string[]) ?? []} onChange={(next) => void saveSetting('internal_preview_addresses', next)} />
            <Group grow align="flex-start">
              <TextInput disabled={!admin} label="Operations alert email" defaultValue={(settings.data.ops_alert_email as string) ?? ''} onBlur={(e) => void saveSetting('ops_alert_email', e.currentTarget.value || null)} />
              <NumberInput disabled={!admin} label="Daily send cap" description="Campaigns per UTC day. Empty means dispatch is blocked." min={0} defaultValue={(settings.data.daily_send_cap as number) ?? ''} onBlur={(e) => void saveSetting('daily_send_cap', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
              <NumberInput disabled={!admin} label="Cost per 1,000 emails (USD)" description="Used for the cost estimate card" min={0} decimalScale={4} defaultValue={(settings.data.cost_per_1000_emails_usd as number) ?? ''} onBlur={(e) => void saveSetting('cost_per_1000_emails_usd', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
            </Group>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
