import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { showError, showSuccess } from '../lib/util';

// One confirmation box for every delete in the app. The database decides what can really be deleted.
export function ConfirmDelete({ opened, title, message, confirmLabel, success, onClose, onConfirm, onDone }: {
  opened: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  success: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await onConfirm();
      showSuccess(success);
      onDone();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack>
        <Text size="sm">{message}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button color="red" loading={busy} onClick={() => void run()}>{confirmLabel}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
