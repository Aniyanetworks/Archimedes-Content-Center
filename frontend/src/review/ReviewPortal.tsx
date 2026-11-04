import { useEffect, useState } from 'react';
import { Alert, Button, Center, Group, Loader, Modal, Paper, Stack, Text, Textarea, ThemeIcon, Title } from '@mantine/core';
import { IconCheck, IconClockHour4, IconLinkOff } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { ReviewAction, ReviewView } from '../api/types';
import { BrandMark } from '../components/BrandMark';
import { EmailPreview } from '../components/EmailPreview';
import { formatDateTime } from '../lib/util';

function TopBar({ tenant }: { tenant?: string }) {
  return (
    <header className="review-top">
      <div className="review-top-inner">
        <BrandMark size={30} />
        <div>
          <div className="app-brand-name">Newsletter review</div>
          {tenant && <div className="app-brand-sub">{tenant}</div>}
        </div>
      </div>
    </header>
  );
}

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
      <div className="review-page">
        <TopBar />
        <Center p="md" mih="70vh">
          <Paper withBorder p="xl" maw={460}>
            <Stack align="center" ta="center" gap="sm">
              <ThemeIcon size={48} radius="xl" variant="light" color="gray" aria-hidden="true"><IconLinkOff size={24} /></ThemeIcon>
              <Title order={3}>This review link is not available</Title>
              <Text c="dimmed" size="sm">{error}</Text>
              <Text c="dimmed" size="sm">Links expire at the approval deadline. Contact Archimedes support if you need a new one.</Text>
            </Stack>
          </Paper>
        </Center>
      </div>
    );
  }

  const pending = view.state === 'pending';

  return (
    <div className="review-page">
      <TopBar tenant={view.tenant_name} />
      <main className="review-layout">
        <div>
          <EmailPreview html={view.html} height={820} />
        </div>
        <aside className="review-panel">
          <Paper withBorder p="lg">
            <Stack gap="md">
              <div>
                <Text size="xs" c="dimmed" fw={500}>{view.newsletter_name}</Text>
                <Title order={3} fz="lg" mt={2}>{view.subject}</Title>
              </div>

              {error && <Alert color="red" title="Your decision was not recorded">{error}</Alert>}

              {pending ? (
                <>
                  <div className="review-deadline">
                    <Group gap={6} wrap="nowrap" mb={2}>
                      <IconClockHour4 size={16} />
                      <Text size="sm" fw={600}>Please decide by {formatDateTime(view.deadline, view.timezone)}</Text>
                    </Group>
                    <Text size="xs">Without a decision by then, this newsletter is held and will not be sent.</Text>
                  </div>
                  <Text size="sm" c="dimmed">Planned send: {formatDateTime(view.send_at, view.timezone)}</Text>
                  <Stack gap="xs">
                    <Button color="teal" size="md" fullWidth onClick={() => setConfirm('approve')}>Approve</Button>
                    <Button variant="default" fullWidth onClick={() => setConfirm('request_changes')}>Request changes</Button>
                    <Button variant="subtle" color="gray" fullWidth onClick={() => setConfirm('skip')}>Skip this edition</Button>
                  </Stack>
                </>
              ) : (
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <ThemeIcon size={32} radius="xl" variant="light" color={view.state === 'decided' ? 'teal' : 'gray'} aria-hidden="true">
                    {view.state === 'decided' ? <IconCheck size={18} /> : <IconLinkOff size={18} />}
                  </ThemeIcon>
                  <Text size="sm">{view.message ?? 'This review is closed.'}</Text>
                </Group>
              )}

              <Text size="xs" c="dimmed">Version {view.version_hash.slice(0, 12)}. Your decision applies only to this exact version.</Text>
            </Stack>
          </Paper>
        </aside>
      </main>

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
              color={confirm === 'approve' ? 'teal' : undefined}
              loading={!!submitting}
              disabled={confirm === 'request_changes' && !notes.trim()}
              onClick={() => confirm && void decide(confirm)}
            >
              {confirm === 'approve' ? 'Approve' : confirm === 'skip' ? 'Skip edition' : 'Send request'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
