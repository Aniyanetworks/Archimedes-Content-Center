import { useState } from 'react';
import { Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { api } from '../api';
import { showError, showSuccess } from '../lib/util';

const MIN_PASSWORD = 8;

// Lets the signed-in person choose a new password for their own login.
export function ChangePasswordModal({ opened, onClose, email }: { opened: boolean; onClose: () => void; email?: string | null }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;

  const close = () => { setPassword(''); setConfirm(''); onClose(); };

  async function save() {
    setBusy(true);
    try {
      await api.updatePassword(password);
      showSuccess('Password changed. Use the new one next time you sign in.');
      close();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={close} title="Change your password" centered>
      <form onSubmit={(event) => { event.preventDefault(); if (password.length >= MIN_PASSWORD && password === confirm) void save(); }}>
        <Stack>
          {email && <Text size="sm" c="dimmed">For {email}. You stay signed in on this computer.</Text>}
          <PasswordInput label="New password" description={`At least ${MIN_PASSWORD} characters`} required data-autofocus autoComplete="new-password"
            value={password} error={tooShort ? `At least ${MIN_PASSWORD} characters` : undefined} onChange={(e) => setPassword(e.currentTarget.value)} />
          <PasswordInput label="Confirm new password" required autoComplete="new-password"
            value={confirm} error={mismatch ? 'Passwords do not match' : undefined} onChange={(e) => setConfirm(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={password.length < MIN_PASSWORD || password !== confirm}>Change password</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
