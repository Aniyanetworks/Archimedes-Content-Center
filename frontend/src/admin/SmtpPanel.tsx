import { useState } from 'react';
import { Alert, Badge, Button, Group, NumberInput, Paper, PasswordInput, SimpleGrid, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { SmtpRequest, SmtpStatus } from '../api/types';
import { hintLabel } from '../components/HintLabel';
import { formatDateTime, showError, showSuccess } from '../lib/util';

// Admin only. The password goes straight to n8n's encrypted store and is never shown again.
export function SmtpPanel() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['smtp'], queryFn: () => api.smtpSettings({ action: 'status' }), retry: false });
  const config = status.data?.config ?? null;
  const workflows = status.data?.workflows ?? [];
  const allOn = workflows.length > 0 && workflows.every((w) => w.active);

  const [editing, setEditing] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(465);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<SmtpStatus['test'] | null>(null);

  const showForm = editing || (!status.isLoading && !status.error && !config);

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
    } catch (error) {
      showError(error);
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

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>{hintLabel('Email server (SMTP)', 'The mail server n8n uses to send review invites and alerts. The password goes straight into n8n and is never stored in this app or shown again. Staff invites and password-reset emails are sent by Supabase and are set up separately in the Supabase dashboard.')}</Title>
        {config && !editing && <Badge color={test ? (test.ok ? 'green' : 'red') : 'gray'} variant="light">{test ? (test.ok ? 'Connection works' : 'Connection failed') : 'Saved'}</Badge>}
      </Group>

      {status.error && <Alert color="red" mb="sm">{(status.error as Error).message}</Alert>}

      {config && !editing && (
        <Stack gap="xs">
          <Text size="sm">
            <b>{config.host}</b>, port {config.port}{config.secure ? ' (SSL)' : ' (STARTTLS)'}, signed in as <b>{config.user}</b>
          </Text>
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

      {workflows.length > 0 && (
        <div className="tool-row" style={{ marginTop: 16 }}>
          <div>
            <Text fw={600} size="sm">{hintLabel('Email workflows', 'The n8n workflows that send email: review invites (04), missed-deadline notices (05) and operations alerts (09). Turn them on once the connection works and the Sender email is filled in.')}</Text>
            <Group gap={6} mt={6}>
              {workflows.map((w) => (
                <Badge key={w.id} variant="light" color={w.active ? 'green' : 'gray'}>{w.name.replace(/^Archimedes /, '')} · {w.active ? 'On' : 'Off'}</Badge>
              ))}
            </Group>
          </div>
          {allOn
            ? <Button variant="default" loading={busy === 'workflows'} onClick={() => void call({ action: 'workflows', on: false }, 'workflows').then((r) => r && showSuccess('Email workflows turned off.'))}>Turn off</Button>
            : <Button loading={busy === 'workflows'} disabled={!config} onClick={() => void call({ action: 'workflows', on: true }, 'workflows').then((r) => r && showSuccess('Email workflows turned on.'))}>Turn on</Button>}
        </div>
      )}
    </Paper>
  );
}
