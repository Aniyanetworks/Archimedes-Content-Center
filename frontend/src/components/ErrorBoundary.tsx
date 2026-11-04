import { Component, type ReactNode } from 'react';
import { Button, Center, Stack, Text, Title } from '@mantine/core';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Center mih="100vh" p="md">
        <Stack align="center" maw={480} ta="center">
          <Title order={3}>Something went wrong on this page</Title>
          <Text c="dimmed" size="sm">{this.state.error.message}</Text>
          <Button variant="default" onClick={() => window.location.reload()}>Reload</Button>
        </Stack>
      </Center>
    );
  }
}
