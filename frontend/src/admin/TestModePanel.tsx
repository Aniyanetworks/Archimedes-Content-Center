import { useState } from 'react';
import { Alert, Button, Group, Modal, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { showError, showSuccess } from '../lib/util';

type Confirming = 'reset' | 'live' | null;

const PHRASE = { reset: 'RESET', live: 'GO LIVE' };

// Admin only. Reset and Go live ask for a typed phrase, and the database checks it again.
export function TestModePanel({ isTest }: { isTest: boolean }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [typed, setTyped] = useState('');

  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await work();
      showSuccess(message);
      setConfirming(null);
      setTyped('');
      await client.invalidateQueries();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!isTest) {
    return (
      <Paper withBorder p="md">
        <Title order={4} mb="xs">Live system</Title>
        <Text size="sm" c="dimmed">This system is live. Test tools are disabled, and the audit log can never be reset.</Text>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md">
      <Title order={4} mb="xs">Test mode</Title>
      <Alert color="yellow" mb="md">Test mode is on. Sends can only reach test contacts, and review invites only go to internal preview addresses.</Alert>
      <Stack gap="md">
        <div>
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">Load test data</Text>
              <Text size="sm" c="dimmed">Adds sample Equinox, Summit Peak, Timber Ridge and Craft Mountain tenants, each with an approved edition for next week.</Text>
            </div>
            <Button variant="default" loading={busy} onClick={() => void run(api.seedTestData, 'Test data loaded. n8n renders it within about 5 minutes.')}>Load test data</Button>
          </Group>
        </div>
        <div>
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">Send test batch now</Text>
              <Text size="sm" c="dimmed">Moves rendered campaigns forward so they dispatch on the next n8n run, instead of waiting for their send day.</Text>
            </div>
            <Button variant="default" loading={busy} onClick={() => void run(api.testSendNow, 'Rendered campaigns moved forward.')}>Send test batch now</Button>
          </Group>
        </div>
        <div>
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">Reset test data</Text>
              <Text size="sm" c="dimmed">Deletes tenants, content, editions, campaigns, approvals and the audit log. Keeps staff logins, plans and templates, and turns dry run and safe test mode back on.</Text>
            </div>
            <Button color="red" variant="light" onClick={() => setConfirming('reset')}>Reset test data</Button>
          </Group>
        </div>
        <div>
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">Go live</Text>
              <Text size="sm" c="dimmed">Ends test mode for good. Reset is disabled permanently and the audit log becomes permanent. Requires test data to be reset first.</Text>
            </div>
            <Button color="red" onClick={() => setConfirming('live')}>Go live</Button>
          </Group>
        </div>
      </Stack>

      <Modal opened={!!confirming} onClose={() => { setConfirming(null); setTyped(''); }} title={confirming === 'reset' ? 'Reset all test data?' : 'Go live?'}>
        {confirming && (
          <Stack>
            <Text size="sm">
              {confirming === 'reset'
                ? 'This permanently deletes all tenants, content, editions, campaigns, approvals and audit entries in this project.'
                : 'This cannot be undone. The system can never return to test mode or be reset.'}
            </Text>
            <TextInput label={`Type ${PHRASE[confirming]} to confirm`} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => { setConfirming(null); setTyped(''); }}>Back</Button>
              <Button
                color="red"
                loading={busy}
                disabled={typed !== PHRASE[confirming]}
                onClick={() => void (confirming === 'reset'
                  ? run(() => api.resetTestData(typed), 'Test data reset.')
                  : run(() => api.goLive(typed), 'The system is now live.'))}
              >
                {confirming === 'reset' ? 'Reset test data' : 'Go live'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
