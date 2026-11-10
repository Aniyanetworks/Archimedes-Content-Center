import { ActionIcon, Anchor, Badge, Button, Group, Indicator, Popover, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconBell, IconCheck } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { OpsAlert, StaffRole } from '../api/types';
import { renameTerms } from '../lib/terms';
import { formatDateTime, showError } from '../lib/util';

// Plain titles for each kind of problem. Anything new falls back to its readable name.
const TITLES: Record<string, string> = {
  campaign_blocked: 'A newsletter was put on hold before sending',
  daily_cap_not_set: 'Sending is blocked: no daily send cap',
  daily_cap_reached: 'Daily send cap reached',
  dead_letter: 'A newsletter gave up after several tries',
  delivery_failed: 'A newsletter was not delivered',
  delivery_partial: 'A newsletter was only partly delivered',
  delivery_unverified: 'Delivery could not be confirmed',
  dispatch_failed: 'A newsletter could not be scheduled',
  dispatch_unknown: 'Unsure whether a newsletter was scheduled',
  edition_changed_while_sending: 'A campaign changed while sending',
  ghl_cancel_failed: 'Could not cancel a newsletter in GoHighLevel',
  ghl_state_mismatch: 'GoHighLevel shows something different',
  reconcile_unreachable: 'Could not reach GoHighLevel to check',
  render_failed: 'A newsletter could not be built',
  review_deadline_missed: 'An owner missed the approval deadline',
  revision_requested: 'An owner asked for changes',
  scheduled_after_stop: 'A newsletter was scheduled after a pause',
  sent_after_stop: 'A newsletter was sent after a pause',
  workflow_error: 'A background task failed',
};
const COLOR: Record<OpsAlert['severity'], string> = { critical: 'red', warning: 'orange', info: 'blue' };
const WORD: Record<OpsAlert['severity'], string> = { critical: 'Urgent', warning: 'Check', info: 'Note' };

export function AlertBell({ role }: { role: StaffRole | null | undefined }) {
  const client = useQueryClient();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: api.listOpenAlerts, refetchInterval: 60_000 });
  const list = alerts.data ?? [];
  const urgent = list.some((a) => a.severity === 'critical');
  const canResolve = role === 'admin' || role === 'operator';

  async function resolve(id: number | null) {
    try {
      await api.resolveAlerts(id);
      await client.invalidateQueries({ queryKey: ['alerts'] });
    } catch (error) {
      showError(error);
    }
  }

  return (
    <Popover width={420} position="bottom-end" shadow="md" withArrow>
      <Popover.Target>
        <Tooltip label={list.length ? `${list.length} problem${list.length > 1 ? 's' : ''} to check` : 'No problems'}>
          <Indicator disabled={!list.length} label={list.length > 99 ? '99+' : list.length} size={18} color={urgent ? 'red' : 'orange'} offset={4}>
            <ActionIcon variant="default" size="lg" aria-label={`Problems: ${list.length}`}><IconBell size={18} /></ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text fw={600} size="sm">Problems to check</Text>
          {canResolve && list.length > 1 && <Button size="compact-xs" variant="subtle" onClick={() => void resolve(null)}>Mark all done</Button>}
        </Group>
        {list.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="lg">Nothing needs attention.</Text>
        ) : (
          <ScrollArea.Autosize mah={420}>
            <Stack gap={0}>
              {list.map((alert) => (
                <Group key={alert.id} wrap="nowrap" align="flex-start" gap="sm" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                  <Badge size="xs" color={COLOR[alert.severity]} variant="light" mt={3} style={{ flexShrink: 0 }}>{WORD[alert.severity]}</Badge>
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={600}>{TITLES[alert.kind] ?? renameTerms(alert.kind.replace(/_/g, ' '))}</Text>
                    <Text size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>{renameTerms(alert.message)}</Text>
                    <Group gap="xs">
                      <Text size="xs" c="dimmed">{formatDateTime(alert.created_at)}</Text>
                      {alert.tenant_id && <Anchor component={Link} to={`/admin/sub-accounts/${alert.tenant_id}`} size="xs">Open sub-account</Anchor>}
                    </Group>
                  </Stack>
                  {canResolve && (
                    <Tooltip label="Mark as done">
                      <UnstyledButton aria-label="Mark as done" onClick={() => void resolve(alert.id)} style={{ color: 'var(--mantine-color-dimmed)' }}><IconCheck size={18} /></UnstyledButton>
                    </Tooltip>
                  )}
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
