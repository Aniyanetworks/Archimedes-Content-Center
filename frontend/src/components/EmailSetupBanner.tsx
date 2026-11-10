import { Alert, Anchor, List } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';

// Says plainly why notification emails (review invites, missed-deadline notices, alerts) are waiting.
// Matches the checks in notification_sender(): while any blocker remains, the email workflows skip sending.
export function emailSetupProblems(settings: Record<string, unknown> | undefined) {
  if (!settings) return { blockers: [] as string[], warnings: [] as string[] };
  const blockers: string[] = [];
  const warnings: string[] = [];
  const channel = (settings.notification_channel as string | undefined) ?? 'smtp';
  if (!String(settings.notification_from_email ?? '').trim()) blockers.push('The Sender email is empty.');
  if (channel === 'ghl' && !settings.notification_ghl) blockers.push('No GoHighLevel location is saved for sending them.');
  if (channel === 'smtp' && !settings.smtp_config) blockers.push('No email server is saved for sending them.');
  const testing = settings.environment === 'test' || settings.safe_test_mode === true;
  if (testing && !((settings.internal_preview_addresses as string[] | undefined) ?? []).length) {
    warnings.push('While testing, review invites go to the first Internal preview address, and none is set.');
  }
  if (!String(settings.ops_alert_email ?? '').trim()) warnings.push('No Operations alert email is set, so problem alerts wait.');
  return { blockers, warnings };
}

export function EmailSetupBanner({ showLink = true }: { showLink?: boolean }) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const { blockers, warnings } = emailSetupProblems(settings.data);
  if (!blockers.length && !warnings.length) return null;
  const paused = blockers.length > 0;
  return (
    <Alert color={paused ? 'yellow' : 'blue'} title={paused ? 'Notification emails are paused' : 'Notification emails: almost ready'}>
      {paused && 'Review invites and alerts are waiting and go out once this is fixed. Newsletters that miss their deadline meanwhile are still held, but those owners are not told by email.'}
      <List size="sm" mt={4} spacing={2}>
        {[...blockers, ...warnings].map((problem) => <List.Item key={problem}>{problem}</List.Item>)}
      </List>
      {showLink && <Anchor component={Link} to="/admin/settings" size="sm" mt={6} display="inline-block">Fix it in Settings</Anchor>}
    </Alert>
  );
}
