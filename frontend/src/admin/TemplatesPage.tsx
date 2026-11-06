import { PageHeader } from '../components/PageHeader';
import { useState } from 'react';
import { Alert, Badge, Group, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { EmailPreview } from '../components/EmailPreview';
import { renderNewsletter } from '../lib/render.js';
import { SAMPLE_ISSUES } from '../lib/sampleContent';
import type { Division } from '../api/types';


export function TemplatesPage() {
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const [selected, setSelected] = useState<string | null>(null);
  const [division, setDivision] = useState<string | null>('hsg');

  const list = templates.data ?? [];
  const template = list.find((t) => t.key === selected) ?? list[0];
  const issue = SAMPLE_ISSUES[(division ?? 'hsg') as Division];
  const rendered = template
    ? renderNewsletter({ template_html: template.html, labels: template.labels, division, edition: { subject: issue.subject, preview_text: issue.preview_text }, tenant: { division }, brand: issue.brand, hero: issue.hero, secondary: issue.secondary, offer: issue.offer })
    : null;

  return (
    <Stack>
      <PageHeader title="Master templates" description="Five centrally controlled designs. Clients choose a design, never the HTML." />
      <Alert color="blue" title="Pending Archimedes signoff">
        Design names and the two Essentials designs are working choices. Compare the final Protection Report against the original Equinox .msg before approval.
      </Alert>

      <Paper withBorder p="sm">
        <Title order={4} mb="xs">Plan entitlements</Title>
        <ScrollArea>
          <Table miw={720}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Design</Table.Th>
                <Table.Th>Version</Table.Th>
                {(plans.data ?? []).map((plan) => <Table.Th key={plan.plan_key}>{plan.label}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((t) => (
                <Table.Tr key={t.key}>
                  <Table.Td fw={600}>{t.name}</Table.Td>
                  <Table.Td>v{t.version}</Table.Td>
                  {(plans.data ?? []).map((plan) => (
                    <Table.Td key={plan.plan_key}>
                      {plan.template_keys.includes(t.key) ? <IconCheck size={16} color="var(--mantine-color-green-7)" aria-label="Included" /> : <Text span c="dimmed" size="sm">Not included</Text>}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} mb="sm">
          <Select label="Design" allowDeselect={false} value={template?.key ?? null} onChange={setSelected} data={list.map((t) => ({ value: t.key, label: t.name }))} />
          <Select label="Labels" allowDeselect={false} value={division} onChange={setDivision} data={[{ value: 'hsg', label: 'Home ServiceGenius' }, { value: 'hospitality', label: 'Hospitality' }]} />
        </SimpleGrid>
        <Group mb="xs"><Badge variant="light" color="gray">Immutable version · example content, fictional business</Badge></Group>
        <EmailPreview html={rendered?.html} />
      </Paper>
    </Stack>
  );
}
