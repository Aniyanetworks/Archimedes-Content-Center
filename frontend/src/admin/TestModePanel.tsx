import { useState } from 'react';
import { Badge, Button, Group, Modal, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { hintLabel } from '../components/HintLabel';
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
        <Title order={4}>{hintLabel('Live system', 'This system is live. Test tools are turned off, and the audit log can never be reset.')}</Title>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md">
      <Group gap="sm" mb="sm">
        <Title order={4}>{hintLabel('Test mode', 'While test mode is on, newsletters only reach test contacts, and review invites only go to the internal preview addresses.')}</Title>
        <Badge color="orange" variant="light">On</Badge>
      </Group>
      <div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Load test data', 'Adds four sample sub-accounts (Equinox, Summit Peak, Timber Ridge and Craft Mountain), each with an approved edition for next week.')}</Text>
            </div><Button variant="default" loading={busy} onClick={() => void run(api.seedTestData, 'Test data loaded. n8n renders it within about 5 minutes.')}>Load test data</Button></div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Send test batch now', 'Sends the ready test newsletters within a few minutes instead of waiting for their send day.')}</Text>
            </div><Button variant="default" loading={busy} onClick={() => void run(api.testSendNow, 'Rendered campaigns moved forward.')}>Send test batch now</Button></div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Reset test data', 'Deletes sub-accounts, stories, editions, campaigns, approvals and the audit log. Keeps staff logins, plans and designs, and turns practice mode and safe test mode back on.')}</Text>
            </div><Button color="red" variant="light" onClick={() => setConfirming('reset')}>Reset test data</Button></div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Go live', 'Ends test mode for good. Reset is turned off forever and the audit log becomes permanent. Reset the test data first.')}</Text>
            </div><Button color="red" onClick={() => setConfirming('live')}>Go live</Button></div>
      </div>

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
