import { useState, type ReactNode } from 'react';
import { Button, FileButton, Group, Image, Stack, TextInput } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { api } from '../api';
import { showError, showSuccess } from '../lib/util';

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_MB = 5;

// A picture field: paste a link, or upload a picture and the link is filled in for you.
export function ImageInput({ label, value, onChange, placeholder, folder, readOnly = false, required = false }: {
  label: ReactNode;
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  folder: 'stories' | 'logos' | 'examples';
  readOnly?: boolean;
  required?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const showPreview = /^https?:\/\/\S+$/i.test(value);

  async function upload(file: File | null) {
    if (!file) return;
    if (!TYPES.includes(file.type)) { showError(new Error('Choose a PNG, JPG, GIF or WebP picture.')); return; }
    if (file.size > MAX_MB * 1024 * 1024) { showError(new Error(`The picture is larger than ${MAX_MB} MB. Make it smaller and try again.`)); return; }
    setBusy(true);
    try {
      const url = await api.uploadImage(file, folder);
      onChange(url);
      showSuccess('Picture uploaded');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap={6}>
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <TextInput style={{ flex: 1 }} label={label} placeholder={placeholder} type="url" required={required} readOnly={readOnly}
          value={value} onChange={(e) => onChange(e.currentTarget.value)} />
        {!readOnly && (
          <FileButton onChange={(file) => void upload(file)} accept={TYPES.join(',')}>
            {(props) => <Button {...props} variant="default" loading={busy} leftSection={<IconUpload size={16} />}>Upload</Button>}
          </FileButton>
        )}
      </Group>
      {showPreview && <Image src={value} alt="" h={72} w="auto" fit="contain" radius="sm" style={{ alignSelf: 'flex-start', maxWidth: 240 }} fallbackSrc="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" />}
    </Stack>
  );
}
