import type { ReactNode } from 'react';
import { Group, Text, Title } from '@mantine/core';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <Title order={2}>{title}</Title>
        {description && <Text c="dimmed" size="sm" mt={2}>{description}</Text>}
      </div>
      {/* Buttons stay together on the right, however many there are. */}
      {actions && <Group gap="xs" wrap="wrap" justify="flex-end">{actions}</Group>}
    </div>
  );
}
