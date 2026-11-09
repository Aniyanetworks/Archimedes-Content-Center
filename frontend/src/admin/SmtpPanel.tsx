import { useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Code, CopyButton, Group, List, NumberInput, Paper, PasswordInput, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { NotificationChannel, NotificationGhl, SmtpRequest, SmtpStatus } from '../api/types';
import { hintLabel } from '../components/HintLabel';
import { formatDateTime, showError, showSuccess } from '../lib/util';

// Admin only. Notification emails (review invites, missed deadlines, alerts) go out either through an
// SMTP server or through GoHighLevel. Both can be set up; one is in use. Secrets are never shown again.
export function SmtpPanel() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const status = useQuery({ queryKey: ['smtp'], queryFn: () => api.smtpSettings({ action: 'status' }), retry: false });
  const channel = (settings.data?.notification_channel as NotificationChannel | undefined) ?? 'ghl';
  const ghl = (settings.data?.notification_ghl as NotificationGhl | null | undefined) ?? null;
  const smtpConfig = status.data?.config ?? null;
  const workflows = status.data?.workflows ?? [];
  const allOn = workflows.length > 0 && workflows.every((w) => w.active);
  const [tab, setTab] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const ready: Record<NotificationChannel, boolean> = { smtp: !!smtpConfig, ghl: !!ghl };

  async function useMethod(next: NotificationChannel) {
    setBusy('channel');
    try {
      await api.setNotificationChannel(next);
      showSuccess(next === 'ghl' ? 'Notification emails now go through GoHighLevel.' : 'Notification emails now go through the email server.');
      await client.invalidateQueries({ queryKey: ['settings'] });
      await client.invalidateQueries({ queryKey: ['audit'] });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function toggleWorkflows(on: boolean) {
    setBusy('workflows');
    try {
      const result = await api.smtpSettings({ action: 'workflows', on });
      client.setQueryData<SmtpStatus>(['smtp'], (current) => ({ ...current, workflows: result.workflows }));
      showSuccess(on ? 'Email workflows turned on.' : 'Email workflows turned off.');
      await client.invalidateQueries({ queryKey: ['audit'] });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  const methodHeader = (method: NotificationChannel, label: string) => (
    <Group justify="space-between" mb="sm">
      <Text size="sm" c="dimmed">{label}</Text>
      {channel === method
        ? <Badge color="green" variant="light">In use</Badge>
        : <Button size="xs" variant="light" disabled={!ready[method]} loading={busy === 'channel'} onClick={() => void useMethod(method)}>Use this method</Button>}
    </Group>
  );

  return (
    <Paper withBorder p="md">
      <Title order={4} mb="sm">{hintLabel('How notification emails are sent', 'Review invites, missed-deadline notices and operations alerts go out through GoHighLevel (the default) or your own email server (SMTP). You can set up both and switch at any time. Staff invites and password-reset emails are sent by Supabase and are set up separately.')}</Title>
      <Tabs value={tab ?? channel} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="ghl" rightSection={channel === 'ghl' ? <Badge size="xs" color="green" variant="light">In use</Badge> : null}>GoHighLevel</Tabs.Tab>
          <Tabs.Tab value="smtp" rightSection={channel === 'smtp' ? <Badge size="xs" color="green" variant="light">In use</Badge> : null}>Email server (SMTP)</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="ghl">
          {methodHeader('ghl', 'Send from one GoHighLevel location you own. Each recipient is added as a contact there.')}
          <GhlSection ghl={ghl} />
        </Tabs.Panel>
        <Tabs.Panel value="smtp">
          {methodHeader('smtp', 'Send through your own mail server, such as Google Workspace, Microsoft 365 or SendGrid.')}
          <SmtpSection status={status.data} loading={status.isLoading} error={status.error as Error | null} />
        </Tabs.Panel>
      </Tabs>

      {workflows.length > 0 && (
        <div className="tool-row" style={{ marginTop: 16 }}>
          <div>
            <Text fw={600} size="sm">{hintLabel('Email workflows', 'The n8n workflows that send these emails: review invites (04), missed-deadline notices (05) and operations alerts (09). Turn them on once the method in use is set up and the Sender email is filled in.')}</Text>
            <Group gap={6} mt={6}>
              {workflows.map((w) => (
                <Badge key={w.id} variant="light" color={w.active ? 'green' : 'gray'}>{w.name.replace(/^Archimedes /, '')} · {w.active ? 'On' : 'Off'}</Badge>
              ))}
            </Group>
          </div>
          {allOn
            ? <Button variant="default" loading={busy === 'workflows'} onClick={() => void toggleWorkflows(false)}>Turn off</Button>
            : <Button loading={busy === 'workflows'} disabled={!ready[channel]} onClick={() => void toggleWorkflows(true)}>Turn on</Button>}
        </div>
      )}
    </Paper>
  );
}

function SmtpSection({ status, loading, error }: { status: SmtpStatus | undefined; loading: boolean; error: Error | null }) {
  const client = useQueryClient();
  const config = status?.config ?? null;
  const [editing, setEditing] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(465);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<SmtpStatus['test'] | null>(null);

  const showForm = editing || (!loading && !error && !config);

  function startEditing() {
    setHost(config?.host ?? '');
    setPort(config?.port ?? 465);
    setUser(config?.user ?? '');
    setSecure(config?.secure ?? true);
    setPassword('');
    setEditing(true);
  }

  // Port 465 uses SSL from the start; 587 (and 25) upgrade with STARTTLS, so SSL is off for those.
  function changePort(value: number | string) {
    const next = Number(value) || 0;
    setPort(next);
    if (next === 465) setSecure(true);
    if (next === 587 || next === 25) setSecure(false);
  }

  async function call(request: SmtpRequest, key: string) {
    setBusy(key);
    try {
      const result = await api.smtpSettings(request);
      if (result.test) setTest(result.test);
      client.setQueryData<SmtpStatus>(['smtp'], (current) => ({ ...current, ...('config' in result ? { config: result.config } : {}), ...(result.workflows ? { workflows: result.workflows } : {}) }));
      await client.invalidateQueries({ queryKey: ['audit'] });
      return result;
    } catch (failure) {
      showError(failure);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const result = await call({ action: 'save', host, port, user, password, secure }, 'save');
    if (!result) return;
    setPassword('');
    setEditing(false);
    showSuccess(result.test?.ok ? 'Email server saved and the connection works.' : 'Email server saved, but the connection test failed. See the message below.');
  }

  const canSave = host.trim() && user.trim() && password && port > 0;

  if (error) return /not set up yet/i.test(error.message) ? <N8nSetupGuide /> : <Alert color="red">{error.message}</Alert>;

  return (
    <>
      {config && !editing && (
        <Stack gap="xs">
          <Group gap="xs">
            <Text size="sm">
              <b>{config.host}</b>, port {config.port}{config.secure ? ' (SSL)' : ' (STARTTLS)'}, signed in as <b>{config.user}</b>
            </Text>
            {test && <Badge color={test.ok ? 'green' : 'red'} variant="light">{test.ok ? 'Connection works' : 'Connection failed'}</Badge>}
          </Group>
          <Text size="xs" c="dimmed">Password saved in n8n · Last changed {formatDateTime(config.updated_at)}</Text>
          {test && !test.ok && <Alert color="red" p="sm" title="The connection test failed">{test.message}</Alert>}
          <Group gap="xs" mt={4}>
            <Button variant="default" loading={busy === 'test'} onClick={() => void call({ action: 'test' }, 'test').then((r) => r?.test?.ok && showSuccess('The connection works.'))}>Test connection</Button>
            <Button variant="subtle" onClick={startEditing}>Change settings</Button>
          </Group>
        </Stack>
      )}

      {showForm && (
        <form onSubmit={(event) => { event.preventDefault(); if (canSave) void save(); }}>
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 3 }} className="field-grid">
              <TextInput label={hintLabel('Server address', 'From your email provider, for example smtp.gmail.com, smtp.office365.com or smtp.sendgrid.net.')} placeholder="smtp.yourprovider.com" required value={host} onChange={(e) => setHost(e.currentTarget.value)} />
              <NumberInput label={hintLabel('Port', 'Usually 465 (SSL) or 587 (STARTTLS). Your email provider tells you which one.')} placeholder="465" min={1} max={65535} required value={port} onChange={changePort} />
              <Switch mb={8} label={hintLabel('Use SSL', 'On for port 465. Off for port 587, which upgrades to a secure connection on its own (STARTTLS).')} checked={secure} onChange={(e) => setSecure(e.currentTarget.checked)} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }} className="field-grid">
              <TextInput label={hintLabel('Username', 'Usually the full email address of the sending mailbox.')} placeholder="notifications@yourdomain.com" required autoComplete="off" value={user} onChange={(e) => setUser(e.currentTarget.value)} />
              <PasswordInput label={hintLabel('Password', config ? 'Enter the password again to save changes. It goes straight to n8n and is never shown again.' : 'Goes straight to n8n and is never shown again. For Gmail or Microsoft 365, use an app password.')} placeholder={config ? 'Enter the password again' : 'Mailbox or app password'} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            </SimpleGrid>
            <Group justify="flex-end" gap="xs">
              {editing && <Button variant="default" onClick={() => { setEditing(false); setPassword(''); }} disabled={busy === 'save'}>Cancel</Button>}
              <Button type="submit" loading={busy === 'save'} disabled={!canSave}>Save and test</Button>
            </Group>
          </Stack>
        </form>
      )}
    </>
  );
}

// Where to make the token, and exactly which permissions to tick in GoHighLevel.
function TokenHint({ saved }: { saved: boolean }) {
  return (
    <Stack gap={4}>
      {saved && <div>Leave empty to keep the saved token, or paste a new one.</div>}
      <div><b>Where:</b> GoHighLevel, Settings, Private Integrations, Create new integration.</div>
      <div><b>Tick only these 4 permissions:</b></div>
      <div>• View Contacts (contacts.readonly)</div>
      <div>• Edit Contacts (contacts.write)</div>
      <div>• Edit Conversations (conversations.write)</div>
      <div>• Edit Conversation Messages (conversations/message.write)</div>
      <div>It is stored encrypted and never shown again.</div>
    </Stack>
  );
}

function GhlSection({ ghl }: { ghl: NotificationGhl | null }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; to?: string; error?: string } | null>(null);
  const showForm = editing || !ghl;

  function startEditing() {
    setLocation(ghl?.location_id ?? '');
    setToken('');
    setEditing(true);
  }

  async function save() {
    setBusy('save');
    try {
      await api.saveNotificationGhl(location.trim(), token.trim() || null);
      setToken('');
      setEditing(false);
      showSuccess('GoHighLevel details saved. Send a test email to check them.');
      await client.invalidateQueries({ queryKey: ['settings'] });
      await client.invalidateQueries({ queryKey: ['audit'] });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy('test');
    try {
      const result = await api.sendGhlTestEmail();
      setTest(result);
      if (result.ok) showSuccess(`Test email sent to ${result.to}. Check that inbox, including spam.`);
      await client.invalidateQueries({ queryKey: ['audit'] });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  const canSave = location.trim() && (token.trim() || ghl);

  return (
    <>
      {ghl && !editing && (
        <Stack gap="xs">
          <Group gap="xs">
            <Text size="sm">Sending from GoHighLevel location <b>{ghl.location_id}</b></Text>
            {test && <Badge color={test.ok ? 'green' : 'red'} variant="light">{test.ok ? 'Test email sent' : 'Test failed'}</Badge>}
          </Group>
          <Text size="xs" c="dimmed">Token saved securely · Last changed {formatDateTime(ghl.updated_at)}</Text>
          {test && !test.ok && <Alert color="red" p="sm" title="The test email was not sent">{test.error}</Alert>}
          {test?.ok && <Text size="xs" c="dimmed">Sent to {test.to}. If it is not in the inbox, check spam: the location needs a verified sending domain.</Text>}
          <Group gap="xs" mt={4}>
            <Button variant="default" loading={busy === 'test'} onClick={() => void sendTest()}>Send test email to me</Button>
            <Button variant="subtle" onClick={startEditing}>Change settings</Button>
          </Group>
        </Stack>
      )}

      {showForm && (
        <form onSubmit={(event) => { event.preventDefault(); if (canSave) void save(); }}>
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2 }} className="field-grid">
              <TextInput label={hintLabel('Location ID', 'The GoHighLevel sub-account to send from. Find it in GoHighLevel under Settings → Business Profile → Location ID. Use a location you own, not a client\'s.')} placeholder="e.g. cQwQ3iQgRx5E1llflstv" required value={location} onChange={(e) => setLocation(e.currentTarget.value)} />
              <PasswordInput label={hintLabel('Private integration token', <TokenHint saved={!!ghl} />)} placeholder={ghl ? 'Leave empty to keep the saved token' : 'pit-…'} required={!ghl} autoComplete="new-password" value={token} onChange={(e) => setToken(e.currentTarget.value)} />
            </SimpleGrid>
            <Text size="xs" c="dimmed">Emails go out from the Sender email under Notification emails. That address must be on a domain verified in this GoHighLevel location, or they may land in spam.</Text>
            <Group justify="flex-end" gap="xs">
              {editing && <Button variant="default" onClick={() => { setEditing(false); setToken(''); }} disabled={busy === 'save'}>Cancel</Button>}
              <Button type="submit" loading={busy === 'save'} disabled={!canSave}>Save</Button>
            </Group>
          </Stack>
        </form>
      )}
    </>
  );
}

// Shown until the smtp-settings Edge Function knows how to reach n8n. These values are not secret,
// except the API key, which the admin copies from their own n8n or .env file.
const SUPABASE_SECRETS_PAGE = 'https://supabase.com/dashboard/project/fuqnoxadayqzhmitigat/functions/secrets';
const N8N_SECRETS = [
  { name: 'N8N_BASE_URL', value: 'https://n8n.srv1300653.hstgr.cloud', hint: 'The address of your n8n.' },
  { name: 'N8N_API_KEY', value: null, hint: 'Your n8n API key: in n8n go to Settings → n8n API → Create an API key, or copy the N8N_API value from frontend/.env.' },
  { name: 'N8N_EMAIL_WORKFLOW_IDS', value: 'ehxYK3Atd4DpIByY,RJVgfgYmDbiL62xX,nrNUM6W1ZbqoLYcb', hint: 'The n8n workflows that send email (04, 05 and 09), in one line with no spaces.' },
];

function Copy({ value }: { value: string }) {
  return (
    <CopyButton value={value} timeout={1500}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
          <ActionIcon size="sm" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label={`Copy ${value}`}>
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}

function N8nSetupGuide() {
  return (
    <Alert color="blue" variant="light" title="One-time setup: connect this app to n8n">
      <Stack gap="sm">
        <Text size="sm">The app needs to know how to reach n8n before it can save an email server or switch the email workflows on. Do this once:</Text>
        <List type="ordered" size="sm" spacing={6}>
          <List.Item>
            Open the <Anchor href={SUPABASE_SECRETS_PAGE} target="_blank" rel="noreferrer">Supabase Edge Function secrets page</Anchor> (Supabase dashboard → Edge Functions → Secrets).
          </List.Item>
          <List.Item>
            Add these three secrets, typing the names exactly:
            <Table mt={6} withTableBorder fz="xs" verticalSpacing={6}>
              <Table.Tbody>
                {N8N_SECRETS.map((s) => (
                  <Table.Tr key={s.name}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Group gap={4} wrap="nowrap"><Code>{s.name}</Code><Copy value={s.name} /></Group>
                    </Table.Td>
                    <Table.Td>
                      {s.value
                        ? <Group gap={4} wrap="nowrap"><Code style={{ wordBreak: 'break-all' }}>{s.value}</Code><Copy value={s.value} /></Group>
                        : <Text size="xs" c="dimmed">{s.hint}</Text>}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </List.Item>
          <List.Item>Click <b>Save</b>, then refresh this page. This message is replaced by the email server form.</List.Item>
        </List>
        <Text size="xs" c="dimmed">GoHighLevel sending (the first tab, used by default) works without this step. Only saving an SMTP server and switching the email workflows on need it.</Text>
      </Stack>
    </Alert>
  );
}
