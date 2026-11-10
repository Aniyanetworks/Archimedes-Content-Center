import { useState } from 'react';
import { Alert, Badge, Button, Group, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Tenant } from '../api/types';
import { hintLabel } from '../components/HintLabel';
import { formatDateTime, showError, showSuccess } from '../lib/util';

export const TOKEN_HINT = (
  <Stack gap={4}>
    <div><b>What it is:</b> The key that lets this app schedule newsletters in this business's GoHighLevel sub-account.</div>
    <div><b>Where to get it:</b> In GoHighLevel, open the sub-account, then Settings, Private Integrations, Create new integration. Copy the token it shows.</div>
    <div><b>Permissions to tick:</b></div>
    <div>• Every permission that starts with <b>emails/</b> (type "emails" in the search box). For example emails/builder.readonly, emails/builder.write and emails/schedule.readonly</div>
    <div>• View Contacts (contacts.readonly)</div>
    <div>• View Tags (locations/tags.readonly)</div>
    <div><b>Then:</b> click Save and test. If a permission is missing, the test tells you.</div>
    <div>It is stored encrypted and never shown again.</div>
  </Stack>
);

// Lets operators save and test the sub-account's GoHighLevel token, without it ever being shown again.
export function GhlConnectionCard({ tenant, connected, canEdit }: { tenant: Tenant; connected: boolean; canEdit: boolean }) {
  const client = useQueryClient();
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const showForm = canEdit && (editing || !connected);

  async function test() {
    setBusy('test');
    try {
      const answer = await api.checkTenantGhl(tenant.id);
      setResult(answer);
      await client.invalidateQueries({ queryKey: ['audit'] });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    try {
      await api.setTenantGhlToken(tenant.id, token.trim());
      setToken('');
      setEditing(false);
      showSuccess('Token saved. Testing the connection…');
      await client.invalidateQueries({ queryKey: ['tenant', tenant.id] });
      setBusy(null);
      await test();
    } catch (error) {
      showError(error);
      setBusy(null);
    }
  }

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>{hintLabel('GoHighLevel connection', 'Newsletters for this business are scheduled in its own GoHighLevel sub-account. This needs a token from that sub-account. Without it, its newsletters cannot be sent.')}</Title>
        {connected
          ? <Badge color={result && !result.ok ? 'red' : 'green'} variant="light" leftSection={<IconPlugConnected size={12} />}>{result && !result.ok ? 'Not working' : 'Connected'}</Badge>
          : <Badge color="orange" variant="light">Not connected</Badge>}
      </Group>
      <Stack gap="xs">
        <Text size="sm">
          Location <b>{tenant.ghl_location_id || 'not set'}</b>
          {connected && <Text span c="dimmed" size="xs"> · Token saved{tenant.ghl_token_saved_at ? ` ${formatDateTime(tenant.ghl_token_saved_at)}` : ''}</Text>}
        </Text>
        {result && <Alert color={result.ok ? 'green' : 'red'} p="xs">{result.message}</Alert>}
        {!connected && !canEdit && <Text size="sm" c="dimmed">No token is saved yet. Ask an admin or operator to add it.</Text>}
        {showForm ? (
          <form onSubmit={(event) => { event.preventDefault(); if (token.trim()) void save(); }}>
            <Group align="flex-end" gap="xs">
              <PasswordInput style={{ flex: 1, minWidth: 240 }} label={hintLabel('Private integration token', TOKEN_HINT)}
                placeholder={connected ? 'Paste a new token to replace the saved one' : 'pit-…'} autoComplete="new-password" value={token} onChange={(e) => setToken(e.currentTarget.value)} />
              <Button type="submit" loading={busy === 'save'} disabled={!token.trim()}>Save and test</Button>
              {editing && <Button variant="default" onClick={() => { setEditing(false); setToken(''); }}>Cancel</Button>}
            </Group>
          </form>
        ) : connected && (
          <Group gap="xs">
            <Button variant="default" loading={busy === 'test'} onClick={() => void test()}>Test connection</Button>
            {canEdit && <Button variant="subtle" onClick={() => setEditing(true)}>Replace token</Button>}
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
