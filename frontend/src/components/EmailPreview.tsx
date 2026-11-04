import { useState } from 'react';
import { Box, Center, SegmentedControl, Stack, Text } from '@mantine/core';

// sandbox="" gives the email no scripts, no same-origin access, no forms and no navigation.
export function EmailPreview({ html, height = 640 }: { html: string | null | undefined; height?: number }) {
  const [width, setWidth] = useState('desktop');
  if (!html) return <Text c="dimmed">Nothing has been rendered for this campaign yet.</Text>;
  return (
    <Stack gap="xs">
      <Center>
        <SegmentedControl
          size="xs"
          value={width}
          onChange={setWidth}
          data={[{ label: 'Desktop', value: 'desktop' }, { label: 'Mobile', value: 'mobile' }]}
          aria-label="Preview width"
        />
      </Center>
      <Box
        component="iframe"
        title="Rendered newsletter preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={html}
        style={{
          display: 'block',
          margin: '0 auto',
          width: width === 'desktop' ? '100%' : 375,
          maxWidth: '100%',
          height,
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 4,
          background: '#fff',
        }}
      />
    </Stack>
  );
}
