import { useState } from 'react';
import { Badge, Button, Group, Modal, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { hintLabel } from '../components/HintLabel';

// The same three short lines for every test tool, so each hint answers the same questions.
function hint(what: string, when: string, undo: string, undoLabel = 'Can it be undone?') {
  return (
    <Stack gap={4}>
      <div><b>What it does:</b> {what}</div>
      <div><b>When to use it:</b> {when}</div>
      <div><b>{undoLabel}</b> {undo}</div>
    </Stack>
  );
}
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
        <Title order={4}>{hintLabel('Live system', hint('Real newsletters go to real customers.', 'Test tools are switched off.', 'No. The system cannot go back to test mode.'))}</Title>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md">
      <Group gap="sm" mb="sm">
        <Title order={4}>{hintLabel('Test mode', hint('A safe place to try everything. Newsletters only go to test contacts, and approval emails come to you.', 'While setting up and training staff.', 'When you click Go live, once you are ready for real customers.', 'When does it end?'))}</Title>
        <Badge color="orange" variant="light">On</Badge>
      </Group>
      <div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Load test data', hint('Adds four example businesses, each with a newsletter ready for next week.', 'To try the app without your real sub-accounts.', 'Yes, with Reset test data.'))}</Text>
            </div><Button variant="default" loading={busy} onClick={() => void run(api.seedTestData, 'Test data loaded. n8n renders it within about 5 minutes.')}>Load test data</Button></div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Send test batch now', hint('Sends the test newsletters that are ready within a few minutes.', "When you don't want to wait for the normal send day.", 'No, but only test contacts receive them.'))}</Text>
            </div><Button variant="default" loading={busy} onClick={() => void run(api.testSendNow, 'Rendered newsletters moved forward.')}>Send test batch now</Button></div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Reset test data', hint('Deletes all test sub-accounts, stories, campaigns, newsletters and history. Staff logins and designs stay.', 'To start again with a clean system.', 'No. You will be asked to type RESET first.'))}</Text>
            </div><Button color="red" variant="light" onClick={() => setConfirming('reset')}>Reset test data</Button></div>
        <div className="tool-row"><div>
              <Text fw={600} size="sm">{hintLabel('Go live', hint('Turns on real sending to real customers.', 'Only when everything is set up and checked. Reset the test data first.', 'No. Test mode and Reset are gone for good.'))}</Text>
            </div><Button color="red" onClick={() => setConfirming('live')}>Go live</Button></div>
      </div>

      <Modal opened={!!confirming} onClose={() => { setConfirming(null); setTyped(''); }} title={confirming === 'reset' ? 'Reset all test data?' : 'Go live?'}>
        {confirming && (
          <Stack>
            <Text size="sm">
              {confirming === 'reset'
                ? 'This permanently deletes all sub-accounts, content, campaigns, newsletters, approvals and audit entries in this project.'
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
