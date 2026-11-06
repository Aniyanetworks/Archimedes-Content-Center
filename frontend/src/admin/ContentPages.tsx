import { PageHeader } from '../components/PageHeader';
import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, TagsInput, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { ContentItem, ContentStatus, Division } from '../api/types';
import { canEdit, formatDateTime, humanize, showError, showSuccess } from '../lib/util';
import { useAuth } from './AuthContext';

export const CONTENT_COLORS: Record<ContentStatus, string> = {
  draft: 'gray', editorial_review: 'yellow', fact_rights_review: 'orange', approved: 'green', rejected: 'red', retired: 'gray',
};

// Draft -> editorial review -> fact and rights review -> approved (spec section 7).
const NEXT_STEPS: Record<ContentStatus, Array<{ to: ContentStatus; label: string; color?: string }>> = {
  draft: [{ to: 'editorial_review', label: 'Send to editorial review' }],
  editorial_review: [{ to: 'fact_rights_review', label: 'Pass to fact and rights review' }, { to: 'draft', label: 'Return to draft', color: 'gray' }, { to: 'rejected', label: 'Reject', color: 'red' }],
  fact_rights_review: [{ to: 'approved', label: 'Approve this version', color: 'green' }, { to: 'draft', label: 'Return to draft', color: 'gray' }, { to: 'rejected', label: 'Reject', color: 'red' }],
  approved: [{ to: 'retired', label: 'Retire', color: 'gray' }],
  rejected: [{ to: 'draft', label: 'Return to draft', color: 'gray' }],
  retired: [],
};

export function ContentListPage() {
  const { session } = useAuth();
  const content = useQuery({ queryKey: ['content'], queryFn: api.listContent });
  const [status, setStatus] = useState<string | null>(null);
  const rows = (content.data ?? []).filter((item) => !status || item.status === status);

  return (
    <Stack>
      <PageHeader title="Content library" description="Reusable stories, from draft through fact and rights review." actions={<>{canEdit(session?.role) && <Button component={Link} to="/admin/content/new">New story</Button>}</>} />
      <Select placeholder="All statuses" aria-label="Filter by status" clearable maw={260} value={status} onChange={setStatus} data={Object.keys(CONTENT_COLORS).map((value) => ({ value, label: humanize(value) }))} />
      {content.error && <Alert color="red">{(content.error as Error).message}</Alert>}
      <Paper withBorder p="sm">
        <ScrollArea>
          <Table highlightOnHover miw={760}>
            <Table.Thead><Table.Tr><Table.Th>Headline</Table.Th><Table.Th>Industry</Table.Th><Table.Th>Regions</Table.Th><Table.Th>Version</Table.Th><Table.Th>Status</Table.Th><Table.Th>Updated</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td><Anchor component={Link} to={`/admin/content/${item.id}`} size="sm" fw={600}>{item.headline || 'Untitled'}</Anchor></Table.Td>
                  <Table.Td>{humanize(item.industry)}</Table.Td>
                  <Table.Td>{item.regions.join(', ') || 'All'}</Table.Td>
                  <Table.Td>v{item.version}</Table.Td>
                  <Table.Td><Badge variant="light" color={CONTENT_COLORS[item.status]}>{humanize(item.status)}</Badge></Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.updated_at)}</Table.Td>
                </Table.Tr>
              ))}
              {!content.isLoading && rows.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">No stories found.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
    </Stack>
  );
}

const EMPTY: Partial<ContentItem> = { division: 'hsg', industry: 'roofing', regions: [], headline: '', teaser: '', body: '', status: 'draft', version: 1 };

export function ContentEditorPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const existing = useQuery({ queryKey: ['content', id], queryFn: () => api.getContent(id!), enabled: !!id });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const [item, setItem] = useState<Partial<ContentItem>>(EMPTY);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItem(existing.data ?? EMPTY);
    setNotes('');
  }, [existing.data, id]);

  const status = item.status ?? 'draft';
  const editable = canEdit(session?.role) && status === 'draft';
  const field = (key: keyof ContentItem) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setItem((current) => ({ ...current, [key]: value }));
  };

  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await work();
      showSuccess(message);
      await client.invalidateQueries({ queryKey: ['content'] });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(async () => {
    const saved = await api.saveContent(item);
    if (!id) navigate(`/admin/content/${saved}`, { replace: true });
  }, 'Saved');

  const newVersion = () => run(async () => {
    const created = await api.newContentVersion(id!);
    navigate(`/admin/content/${created}`);
  }, 'New draft version created');

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{id ? `Story v${item.version ?? 1}` : 'New story'}</Title>
        <Badge size="lg" variant="light" color={CONTENT_COLORS[status]}>{humanize(status)}</Badge>
      </Group>

      {status === 'approved' && (
        <Alert color="blue">Approved versions are locked so editions stay reproducible. Create a new version to make changes; it goes through review again.</Alert>
      )}
      {item.review_notes && <Alert color="yellow" title="Review notes">{item.review_notes}</Alert>}

      <Paper withBorder p="md">
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select
              label="Division" allowDeselect={false} readOnly={!editable} value={item.division}
              data={[{ value: 'hsg', label: 'Home ServiceGenius' }, { value: 'hospitality', label: 'Hospitality' }]}
              onChange={(value) => setItem((c) => ({ ...c, division: value as Division, industry: industries.data?.find((i) => i.division === value)?.key }))}
            />
            <Select label="Industry" placeholder="Choose an industry" allowDeselect={false} readOnly={!editable} value={item.industry ?? null} data={(industries.data ?? []).filter((i) => i.division === item.division).map((i) => ({ value: i.key, label: i.label }))} onChange={(value) => setItem((c) => ({ ...c, industry: value ?? undefined }))} />
            <TextInput label="Season" placeholder="e.g. Fall" readOnly={!editable} value={item.season ?? ''} onChange={field('season')} />
          </SimpleGrid>
          <TagsInput label="Regions" placeholder="Type a region code, then press Enter (e.g. US-CO)" description="Leave empty for all markets. A story with regions only reaches tenants serving one of them." readOnly={!editable} value={item.regions ?? []} onChange={(regions) => setItem((c) => ({ ...c, regions }))} />
          <TextInput label="Headline" placeholder="What to check on your roof after a storm" required readOnly={!editable} value={item.headline ?? ''} onChange={field('headline')} />
          <Textarea label="Teaser" placeholder="One or two sentences that make readers want to open the story" readOnly={!editable} autosize minRows={2} value={item.teaser ?? ''} onChange={field('teaser')} />
          <Textarea label="Body" placeholder="Write the article here. Leave a blank line between paragraphs." description="Separate paragraphs with a blank line. Avoid unverified statistics, guarantees, weather claims and promotional terms." readOnly={!editable} autosize minRows={8} value={item.body ?? ''} onChange={field('body')} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Image URL" placeholder="https://yourcompany.com/images/roof-inspection.jpg" type="url" readOnly={!editable} value={item.image_url ?? ''} onChange={field('image_url')} />
            <TextInput label="Image alt text" placeholder="e.g. Roofer checking shingles after a storm" description="Describes the image for screen readers" readOnly={!editable} value={item.image_alt ?? ''} onChange={field('image_alt')} />
            <TextInput label="Image license" placeholder="e.g. Own photo, or stock licence and ID" description="Required before the story can be approved" readOnly={!editable} value={item.image_license ?? ''} onChange={field('image_license')} />
            <TextInput label="Expires on" description="The story stops appearing in editions after this date" type="date" readOnly={!editable} value={item.expires_at?.slice(0, 10) ?? ''} onChange={field('expires_at')} />
            <TextInput label="CTA class" placeholder="e.g. assessment" description="For example assessment or booking" readOnly={!editable} value={item.cta_class ?? ''} onChange={field('cta_class')} />
            <TextInput label="CTA label" placeholder="Schedule a roof assessment" description="The button text under the story" readOnly={!editable} value={item.cta_label ?? ''} onChange={field('cta_label')} />
          </SimpleGrid>
          {editable && <Group justify="flex-end"><Button loading={busy} disabled={!item.headline?.trim()} onClick={() => void save()}>Save draft</Button></Group>}
        </Stack>
      </Paper>

      {id && canEdit(session?.role) && (
        <Paper withBorder p="md">
          <Title order={4} mb="sm">Approval workflow</Title>
          {NEXT_STEPS[status].length > 0 && <Textarea label="Notes" placeholder="What the next reviewer should know" autosize minRows={2} mb="sm" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />}
          <Group>
            {NEXT_STEPS[status].map((step) => (
              <Button key={step.to} variant={step.color === 'gray' ? 'default' : 'filled'} color={step.color} loading={busy} onClick={() => void run(() => api.advanceContent(id, step.to, notes || undefined), humanize(step.to))}>
                {step.label}
              </Button>
            ))}
            {(status === 'approved' || status === 'retired') && <Button variant="default" loading={busy} onClick={() => void newVersion()}>Create new version</Button>}
          </Group>
        </Paper>
      )}
    </Stack>
  );
}
