import { useEffect, useState } from 'react';
import { Alert, Button, Center, Container, Group, Loader, Modal, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { ReviewAction, ReviewView } from '../api/types';
import { EmailPreview } from '../components/EmailPreview';
import { formatDateTime } from '../lib/util';

// Public, no login: everything goes through the review Edge Function, which checks the signed
// token, tenant and exact version hash. This page never touches a table directly.
export default function ReviewPortal() {
  const { token = '' } = useParams();
  const [view, setView] = useState<ReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<ReviewAction | null>(null);
  const [confirm, setConfirm] = useState<ReviewAction | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.reviewLoad(token).then(setView).catch((e: Error) => setError(e.message));
  }, [token]);

  async function decide(action: ReviewAction) {
    if (!view) return;
    setSubmitting(action);
    setError(null);
    try {
      setView(await api.reviewDecide(token, action, view.version_hash, notes.trim() || undefined));
      setConfirm(null);
    } catch (e) {
      setError((e as Error).message);
      setConfirm(null);
    } finally {
      setSubmitting(null);
    }
  }

  if (!view && !error) return <Center h="100vh"><Loader /></Center>;
  if (!view) {
    return (
      <Center mih="100vh" p="md">
        <Stack align="center" maw={440} ta="center">
          <Title order={2}>This review link is not available</Title>
          <Text c="dimmed">{error}</Text>
          <Text c="dimmed" size="sm">Links expire at the approval deadline. Contact Archimedes support if you need a new one.</Text>
        </Stack>
      </Center>
    );
  }

  const pending = view.state === 'pending';

  return (
    <Container size="md" py="lg">
      <Stack>
        <div>
          <Text size="sm" c="dimmed">{view.tenant_name}</Text>
          <Title order={2}>{view.newsletter_name}</Title>
          <Text>{view.subject}</Text>
        </div>

        {error && <Alert color="red" title="Your decision was not recorded">{error}</Alert>}
        {!pending && <Alert color={view.state === 'decided' ? 'green' : 'gray'}>{view.message ?? 'This review is closed.'}</Alert>}

        {pending && (
          <Paper withBorder p="md">
            <Text fw={600}>Please decide by {formatDateTime(view.deadline, view.timezone)}</Text>
            <Text size="sm" c="dimmed">
              Planned send: {formatDateTime(view.send_at, view.timezone)}. If we do not hear from you by the deadline, this newsletter is held and will not be sent.
            </Text>
            <Group mt="md">
              <Button color="green" onClick={() => setConfirm('approve')}>Approve</Button>
              <Button variant="default" onClick={() => setConfirm('request_changes')}>Request changes</Button>
              <Button variant="subtle" color="gray" onClick={() => setConfirm('skip')}>Skip this edition</Button>
            </Group>
          </Paper>
        )}

        <Paper withBorder p="sm">
          <EmailPreview html={view.html} height={760} />
        </Paper>
        <Text size="xs" c="dimmed">Version {view.version_hash.slice(0, 12)}. Your decision applies only to this exact version.</Text>
      </Stack>

      <Modal
        opened={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'approve' ? 'Approve this newsletter?' : confirm === 'skip' ? 'Skip this edition?' : 'Request changes'}
      >
        <Stack>
          {confirm === 'approve' && <Text size="sm">It will be sent to your subscribers as shown at the planned send time.</Text>}
          {confirm === 'skip' && <Text size="sm">Nothing will be sent for this edition. Your next edition is not affected.</Text>}
          {confirm === 'request_changes' && (
            <Textarea label="What should change?" required autosize minRows={3} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>Back</Button>
            <Button
              color={confirm === 'approve' ? 'green' : undefined}
              loading={!!submitting}
              disabled={confirm === 'request_changes' && !notes.trim()}
              onClick={() => confirm && void decide(confirm)}
            >
              {confirm === 'approve' ? 'Approve' : confirm === 'skip' ? 'Skip edition' : 'Send request'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
