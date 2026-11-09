import { PageHeader } from '../components/PageHeader';
import { useState } from 'react';
import { Alert, Button, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, TagsInput, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { PauseScope } from '../api/types';
import { canOperate, formatDate, formatDateTime, humanize, showError, showSuccess } from '../lib/util';
import { useAuth } from './AuthContext';
import { hintLabel } from '../components/HintLabel';
import { SmtpPanel } from './SmtpPanel';
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
      <PageHeader title="Settings" description="Stop sending at any level, and control test mode and safety settings." />
      {pauses.error && <Alert color="red">{(pauses.error as Error).message}</Alert>}
      {admin && settings.data && <TestModePanel isTest={settings.data.environment === 'test'} />}

      <Paper withBorder p="md">
        <Title order={4} mb="sm">{hintLabel('Pause switches', 'A pause stops sending straight away. Newsletters waiting to be sent carry on when the pause is lifted. Ones already scheduled in GoHighLevel are pulled back and put on hold, so someone must release them.')}</Title>
        {globalPause && <Alert color="red" mb="sm" title="All sending is paused">{globalPause.reason}</Alert>}
        {operate && (
          <SimpleGrid cols={{ base: 1, sm: 4 }} mb="md">
            <Select label={hintLabel('Level', 'How much to pause: all sending, a division, an industry, one sub-account or one campaign.')} allowDeselect={false} value={scope} onChange={(next) => { setScope(next as PauseScope); setValue(null); }} data={['global', 'division', 'industry', 'tenant', 'edition'].map((s) => ({ value: s, label: humanize(s) }))} />
            {scope !== 'global' ? <Select label={hintLabel('Target', 'Exactly what to pause at that level.')} placeholder="Choose what to pause" searchable value={value} onChange={setValue} data={options[scope]} /> : <TextInput label={hintLabel('Target', 'Everything is paused at this level.')} placeholder="Choose what to pause" value="All sending" disabled />}
            <TextInput label={hintLabel('Reason', 'Why it is paused. The team sees it here, and it is kept in the audit log.')} placeholder="e.g. Waiting for the client to confirm their offer" required value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
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
        <Title order={4} mb="xs">{hintLabel('Safety settings', 'Settings that keep test emails away from real customers and limit what can be sent. Only admins can change them.')}</Title>
        {!admin && <Text size="sm" c="dimmed" mb="sm">Only administrators can change these.</Text>}
        {settings.data && (
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <Switch disabled={!admin} label={hintLabel('GHL dry run', 'Practice mode. The system goes through every step but sends nothing to GoHighLevel. Keep it on until you are ready to send real emails.')} checked={settings.data.ghl_dry_run === true} onChange={(e) => void saveSetting('ghl_dry_run', e.currentTarget.checked)} />
              <Switch disabled={!admin} label={hintLabel('Safe test mode', "Every newsletter goes only to each sub-account's test contacts, never to real customers.")} checked={settings.data.safe_test_mode === true} onChange={(e) => void saveSetting('safe_test_mode', e.currentTarget.checked)} />
            </SimpleGrid>

            <div>
              <Text fw={600} size="sm" mb="xs">Sending limits</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} className="field-grid">
                <NumberInput disabled={!admin} label={hintLabel('Daily send cap', 'The most newsletters sent to GoHighLevel in one day (resets at midnight UTC). Extra ones wait for the next day. While this is empty, no real newsletter is sent.')} placeholder="e.g. 500" min={0} defaultValue={(settings.data.daily_send_cap as number) ?? ''} onBlur={(e) => void saveSetting('daily_send_cap', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
                <NumberInput disabled={!admin} label={hintLabel('Cost per 1,000 emails (USD)', 'What GoHighLevel charges per 1,000 emails. Only used for the cost estimate on the dashboard. It does not limit sending.')} placeholder="e.g. 0.675" min={0} decimalScale={4} defaultValue={(settings.data.cost_per_1000_emails_usd as number) ?? ''} onBlur={(e) => void saveSetting('cost_per_1000_emails_usd', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
              </SimpleGrid>
            </div>

            <div>
              <Text fw={600} size="sm" mb="xs">Notification emails</Text>
              <Stack gap="md">
                <SimpleGrid cols={{ base: 1, sm: 3 }} className="field-grid">
                  <TextInput disabled={!admin} label={hintLabel('Sender email', 'The From address for review invites and alerts. These emails are not sent until it is set.')} placeholder="notifications@yourdomain.com" type="email" defaultValue={(settings.data.notification_from_email as string) ?? ''} onBlur={(e) => void saveSetting('notification_from_email', e.currentTarget.value.trim() || null)} />
                  <TextInput disabled={!admin} label={hintLabel('Sender name', 'The name people see as the sender in their inbox.')} placeholder="Archimedes" defaultValue={(settings.data.notification_from_name as string) ?? ''} onBlur={(e) => void saveSetting('notification_from_name', e.currentTarget.value.trim() || 'Archimedes')} />
                  <TextInput disabled={!admin} label={hintLabel('Operations alert email', 'Where alerts go when something fails, is held, or the daily cap is reached.')} placeholder="ops@yourcompany.com" type="email" defaultValue={(settings.data.ops_alert_email as string) ?? ''} onBlur={(e) => void saveSetting('ops_alert_email', e.currentTarget.value.trim() || null)} />
                </SimpleGrid>
                <TagsInput disabled={!admin} label={hintLabel('Internal preview addresses', 'While testing, review invites go to the first address here instead of the sub-account owner. Type an address and press Enter to add it.')} placeholder="Type an email address, then press Enter" value={(settings.data.internal_preview_addresses as string[]) ?? []} onChange={(next) => void saveSetting('internal_preview_addresses', next)} />
              </Stack>
            </div>

            <div>
              <Text fw={600} size="sm" mb="xs">Delivery checks</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} className="field-grid">
                <NumberInput disabled={!admin} label={hintLabel('Check delivery after (minutes)', 'How long after a newsletter is sent before the app checks whether it reached inboxes.')} placeholder="30" min={5} defaultValue={(settings.data.delivery_check_after_minutes as number) ?? 30} onBlur={(e) => void saveSetting('delivery_check_after_minutes', Number(e.currentTarget.value) || 30)} />
                <NumberInput disabled={!admin} label={hintLabel('Keep re-checking for (hours)', 'If some emails are still on their way, the app keeps checking for this long before giving a final result.')} placeholder="24" min={1} defaultValue={(settings.data.delivery_recheck_hours as number) ?? 24} onBlur={(e) => void saveSetting('delivery_recheck_hours', Number(e.currentTarget.value) || 24)} />
              </SimpleGrid>
            </div>
          </Stack>
        )}
      </Paper>

      {admin && <SmtpPanel />}
    </Stack>
  );
}
