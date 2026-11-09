import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { StaffMember, StaffRole } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { formatDateTime, showError, showSuccess } from '../lib/util';
import { hintLabel } from '../components/HintLabel';
import { useAuth } from './AuthContext';

const ROLES: Array<{ value: StaffRole; label: string; description: string }> = [
  { value: 'admin', label: 'Admin', description: 'Everything, including staff, safety settings and test mode' },
  { value: 'editor', label: 'Editor', description: 'Writes stories, builds and approves weekly campaigns' },
  { value: 'operator', label: 'Operator', description: 'Adds sub-accounts, looks after sending and pauses' },
];
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r.value, label: r.label }));
// What each role can do, shown in the hint next to every Role label.
const ROLE_HINT = (
  <Stack gap={6}>
    {ROLES.map((r) => <div key={r.value}><b>{r.label}:</b> {r.description}</div>)}
    <div>There must always be at least one admin, and you cannot remove your own access.</div>
  </Stack>
);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function StaffPage() {
  const { session, retry } = useAuth();
  const client = useQueryClient();
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.listStaff, enabled: session?.role === 'admin' });
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('editor');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  if (session?.role !== 'admin') {
    return (
      <Stack>
        <PageHeader title="Staff" description="Who can use the admin app." />
        <Alert color="gray">Only admins can manage staff.</Alert>
      </Stack>
    );
  }

  const emailTaken = staff.data?.some((s) => s.email.toLowerCase() === email.trim().toLowerCase());
  const emailValid = EMAIL.test(email.trim());

  async function refresh() {
    await client.invalidateQueries({ queryKey: ['staff'] });
    await client.invalidateQueries({ queryKey: ['audit'] });
  }

  async function invite() {
    setBusy('invite');
    try {
      const result = await api.inviteStaff(email.trim(), role);
      showSuccess(result.status === 'invited'
        ? `Invite sent to ${result.email}. They choose their own password from the email.`
        : `${result.email} already had a login and can sign in now.`);
      setInviting(false);
      setEmail('');
      setRole('editor');
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function resend(member: StaffMember) {
    setBusy(member.user_id);
    try {
      await api.inviteStaff(member.email, member.role);
      showSuccess(`Invite sent again to ${member.email}`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(member: StaffMember, next: StaffRole) {
    if (next === member.role) return;
    setBusy(member.user_id);
    try {
      await api.setStaffRole(member.user_id, next);
      showSuccess(`${member.email} is now ${next === 'editor' ? 'an editor' : next === 'admin' ? 'an admin' : 'an operator'}`);
      await refresh();
      if (member.is_me) retry();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: StaffMember) {
    setRemoving(null);
    setBusy(member.user_id);
    try {
      await api.removeStaff(member.user_id);
      showSuccess(`${member.email} no longer has access`);
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack>
      <PageHeader
        title="Staff"
        description="Who can use the admin app, and what each person can do."
        actions={<Button onClick={() => setInviting(true)}>Invite staff member</Button>}
      />
      {staff.error && <Alert color="red">{(staff.error as Error).message}</Alert>}

      <Paper withBorder p="md">
        <ScrollArea>
          <Table miw={680} verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr><Table.Th>Email</Table.Th><Table.Th w={180}>{hintLabel("Role", ROLE_HINT)}</Table.Th><Table.Th>Last signed in</Table.Th><Table.Th aria-label="Actions" /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {staff.data?.map((member) => (
                <Table.Tr key={member.user_id}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={500}>{member.email}</Text>
                      {member.is_me && <Badge size="sm" variant="light" color="gray">You</Badge>}
                      {member.invite_pending && <Badge size="sm" variant="light" color="yellow">Invite sent</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      aria-label={`Role for ${member.email}`}
                      allowDeselect={false}
                      data={ROLE_OPTIONS}
                      value={member.role}
                      disabled={busy === member.user_id}
                      onChange={(next) => next && void changeRole(member, next as StaffRole)}
                    />
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{member.last_sign_in_at ? formatDateTime(member.last_sign_in_at) : 'Not yet'}</Text></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      {member.invite_pending && (
                        <Button size="xs" variant="default" loading={busy === member.user_id} onClick={() => void resend(member)}>Resend invite</Button>
                      )}
                      {!member.is_me && (
                        <Button size="xs" variant="subtle" color="red" disabled={busy === member.user_id} onClick={() => setRemoving(member)}>Remove</Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {staff.data?.length === 0 && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="md">No staff yet.</Text></Table.Td></Table.Tr>}
              {staff.isLoading && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="md">Loading…</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <Modal opened={inviting} onClose={() => setInviting(false)} title="Invite staff member">
        <form onSubmit={(event) => { event.preventDefault(); if (emailValid && !emailTaken) void invite(); }}>
          <Stack>
            <TextInput
              label={hintLabel('Email', 'They get an email with a link to choose their own password.')}
              placeholder="name@yourcompany.com"
              type="email"
              required
              data-autofocus
              value={email}
              error={emailTaken ? 'This person is already on the staff list' : undefined}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Select
              label={hintLabel('Role', ROLE_HINT)}
              allowDeselect={false}
              data={ROLE_OPTIONS}
              value={role}
              onChange={(next) => next && setRole(next as StaffRole)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setInviting(false)}>Cancel</Button>
              <Button type="submit" loading={busy === 'invite'} disabled={!emailValid || !!emailTaken}>Send invite</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!removing} onClose={() => setRemoving(null)} title="Remove access?">
        <Stack>
          <Text size="sm">{removing?.email} will no longer be able to use the admin app. You can invite them again later.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button color="red" onClick={() => removing && void remove(removing)}>Remove access</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
