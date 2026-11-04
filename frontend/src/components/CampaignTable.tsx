import { useState } from 'react';
import { ActionIcon, Button, Group, Menu, Modal, ScrollArea, Stack, Table, Text, Textarea, Tooltip } from '@mantine/core';
import { IconDotsVertical, IconEye } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { CampaignAction, CampaignRow, StaffRole } from '../api/types';
import { canOperate, formatDate, formatDateTime, humanize, showError, showSuccess } from '../lib/util';
import { EmailPreview } from './EmailPreview';
import { StatusBadge } from './StatusBadge';

const ACTION_LABELS: Record<CampaignAction, string> = {
  hold: 'Hold',
  cancel: 'Cancel',
  retry: 'Retry',
  release: 'Release hold',
  rerender: 'Re-render',
  resend_invite: 'Resend review invite',
  revoke_approval: 'Revoke approval',
};

const CLOSED = ['SENT', 'CANCELED', 'SENDING'];

function availableActions(row: CampaignRow): CampaignAction[] {
  const actions: CampaignAction[] = [];
  if (row.status === 'CLIENT_REVIEW_PENDING') actions.push('resend_invite');
  if (row.status === 'FAILED' && row.dispatch_state !== 'unknown') actions.push('retry');
  if (row.status === 'HELD') actions.push('release');
  if (['FAILED', 'HELD', 'REVISION_REQUESTED', 'REJECTED', 'NOT_ELIGIBLE'].includes(row.status)) actions.push('rerender');
  if (['APPROVED_FOR_SEND', 'SCHEDULED'].includes(row.status) && row.review_mode === 'review') actions.push('revoke_approval');
  if (!CLOSED.includes(row.status) && row.status !== 'HELD') actions.push('hold');
  if (!CLOSED.includes(row.status)) actions.push('cancel');
  return actions;
}

const NEEDS_REASON: CampaignAction[] = ['hold', 'cancel', 'revoke_approval'];

export function CampaignTable({ rows, role, showTenant = true }: { rows: CampaignRow[]; role: StaffRole | null | undefined; showTenant?: boolean }) {
  const client = useQueryClient();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: CampaignRow; action: CampaignAction } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const preview = useQuery({ queryKey: ['campaign-html', previewId], queryFn: () => api.getCampaignHtml(previewId!), enabled: !!previewId });

  async function run(row: CampaignRow, action: CampaignAction, why?: string) {
    setBusy(true);
    try {
      await api.campaignAction(row.id, action, why);
      showSuccess(`${ACTION_LABELS[action]}: ${row.tenant_name}`);
      setPending(null);
      setReason('');
      await client.invalidateQueries();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="xs" miw={880}>
          <Table.Thead>
            <Table.Tr>
              {showTenant && <Table.Th>Tenant</Table.Th>}
              <Table.Th>Edition</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Mode</Table.Th>
              <Table.Th>Send time</Table.Th>
              <Table.Th>Deadline</Table.Th>
              <Table.Th aria-label="Actions" />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const actions = availableActions(row);
              return (
                <Table.Tr key={row.id}>
                  {showTenant && (
                    <Table.Td>
                      <Text size="sm" fw={600} component={Link} to={`/admin/tenants/${row.tenant_id}`} c="inherit" td="none">
                        {row.tenant_name}
                      </Text>
                      <Text size="xs" c="dimmed">{humanize(row.industry)} · {humanize(row.plan_key)}</Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm" lineClamp={1} maw={280}>{row.edition_subject}</Text>
                    <Text size="xs" c="dimmed">Week of {formatDate(row.publication_week)} · v{row.edition_version}</Text>
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge status={row.status} />
                    {(row.status_reason || row.last_error) && (
                      <Tooltip label={row.last_error ?? humanize(row.status_reason)} multiline w={300}>
                        <Text size="xs" c="dimmed" lineClamp={1} maw={200}>{row.last_error ?? humanize(row.status_reason)}</Text>
                      </Tooltip>
                    )}
                  </Table.Td>
                  <Table.Td><Text size="sm">{row.review_mode === 'review' ? 'Review' : 'Automatic'}</Text></Table.Td>
                  <Table.Td><Text size="sm" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.sent_at ?? row.scheduled_at, row.timezone)}</Text></Table.Td>
                  <Table.Td><Text size="sm" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.review_deadline, row.timezone)}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label="Preview">
                        <ActionIcon variant="subtle" color="gray" aria-label={`Preview ${row.tenant_name}`} onClick={() => setPreviewId(row.id)}>
                          <IconEye size={18} />
                        </ActionIcon>
                      </Tooltip>
                      {canOperate(role) && actions.length > 0 && (
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${row.tenant_name}`}>
                              <IconDotsVertical size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {actions.map((action) => (
                              <Menu.Item
                                key={action}
                                color={action === 'cancel' ? 'red' : undefined}
                                onClick={() => (NEEDS_REASON.includes(action) ? setPending({ row, action }) : void run(row, action))}
                              >
                                {ACTION_LABELS[action]}
                              </Menu.Item>
                            ))}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}><Text c="dimmed" ta="center" py="lg">No campaigns match these filters.</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <Modal opened={!!previewId} onClose={() => setPreviewId(null)} title="Rendered preview" size="xl">
        <EmailPreview html={preview.data} />
      </Modal>

      <Modal opened={!!pending} onClose={() => setPending(null)} title={pending ? `${ACTION_LABELS[pending.action]}: ${pending.row.tenant_name}` : ''}>
        <Stack>
          {pending?.action === 'cancel' && pending.row.status === 'SCHEDULED' && (
            <Text size="sm">This campaign is already scheduled in GHL. The engine will ask GHL to delete it, and you should confirm the result in the event history.</Text>
          )}
          <Textarea label="Reason" description="Recorded in the audit log" required value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPending(null)}>Back</Button>
            <Button
              color={pending?.action === 'cancel' ? 'red' : undefined}
              loading={busy}
              disabled={!reason.trim()}
              onClick={() => pending && void run(pending.row, pending.action, reason.trim())}
            >
              {pending ? ACTION_LABELS[pending.action] : ''}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
