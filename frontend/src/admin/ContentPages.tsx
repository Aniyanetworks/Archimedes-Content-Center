import { PageHeader } from '../components/PageHeader';
import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Group, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, TagsInput, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { FilterBar } from '../components/FilterBar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { hintLabel } from '../components/HintLabel';
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

// Matches content_delete in the database. A story used in an edition is refused there with a clear message.
const canDeleteStory = (item: Partial<ContentItem>) => !!item.id && item.status !== 'approved' && item.status !== 'retired';

export function ContentListPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const content = useQuery({ queryKey: ['content'], queryFn: api.listContent });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const editor = canEdit(session?.role);

  const all = content.data ?? [];
  // Only offer filter choices that some story actually has.
  const industryOptions = [...new Set(all.map((item) => item.industry))]
    .map((key) => ({ value: key, label: industries.data?.find((i) => i.key === key)?.label ?? humanize(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const regionOptions = [{ value: '__all__', label: 'Not region-specific' },
    ...[...new Set(all.flatMap((item) => item.regions))].sort().map((r) => ({ value: r, label: r }))];
  const statusTabs = (Object.keys(CONTENT_COLORS) as ContentStatus[])
    .map((value) => ({ value, label: value === 'fact_rights_review' ? 'Fact and rights review' : humanize(value), count: all.filter((item) => item.status === value).length }));

  const words = search.trim().toLowerCase();
  const rows = all.filter((item) =>
    (!words || [item.headline, item.teaser, item.body].some((text) => (text ?? '').toLowerCase().includes(words)))
    && (!industry || item.industry === industry)
    && (!region || (region === '__all__' ? item.regions.length === 0 : item.regions.includes(region)))
    && (!status || item.status === status));
  const filtering = !!(words || industry || region || status);
  const clearFilters = () => { setSearch(''); setIndustry(null); setRegion(null); setStatus(null); };

  return (
    <Stack>
      <PageHeader title="Content library" description="Reusable stories, from draft through fact and rights review." actions={<>{canEdit(session?.role) && <Button component={Link} to="/admin/content/new">New story</Button>}</>} />
      {content.error && <Alert color="red">{(content.error as Error).message}</Alert>}
      <Paper withBorder p="sm">
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search stories"
          tabs={statusTabs}
          tab={status}
          onTab={setStatus}
          selects={[
            { key: 'industry', placeholder: 'All industries', value: industry, onChange: setIndustry, data: industryOptions },
            { key: 'region', placeholder: 'Any region', value: region, onChange: setRegion, data: regionOptions },
          ]}
          total={all.length}
          shown={rows.length}
          noun={['story', 'stories']}
          onClear={clearFilters}
        />
        <ScrollArea>
          <Table highlightOnHover miw={760}>
            <Table.Thead><Table.Tr><Table.Th>Headline</Table.Th><Table.Th>Industry</Table.Th><Table.Th>Regions</Table.Th><Table.Th>Version</Table.Th><Table.Th>Status</Table.Th><Table.Th>Updated</Table.Th>{editor && <Table.Th aria-label="Actions" w={56} />}</Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td><Anchor component={Link} to={`/admin/content/${item.id}`} size="sm" fw={600}>{item.headline || 'Untitled'}</Anchor></Table.Td>
                  <Table.Td>{humanize(item.industry)}</Table.Td>
                  <Table.Td>{item.regions.join(', ') || 'All'}</Table.Td>
                  <Table.Td>v{item.version}</Table.Td>
                  <Table.Td><Badge variant="light" color={CONTENT_COLORS[item.status]}>{humanize(item.status)}</Badge></Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.updated_at)}</Table.Td>
                  {editor && (
                    <Table.Td>
                      {canDeleteStory(item) && (
                        <ActionIcon variant="subtle" color="red" aria-label={`Delete ${item.headline || 'story'}`} title="Delete story" onClick={() => setDeleting(item)}><IconTrash size={16} /></ActionIcon>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
              {!content.isLoading && rows.length === 0 && <Table.Tr><Table.Td colSpan={editor ? 7 : 6}><Text c="dimmed" ta="center" py="lg">{filtering ? 'No stories match these filters.' : 'No stories yet.'}</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      <ConfirmDelete
        opened={!!deleting}
        title="Delete this story?"
        message={`“${deleting?.headline || 'Untitled'}” (v${deleting?.version ?? 1}) will be deleted. This cannot be undone.`}
        confirmLabel="Delete story"
        success="Story deleted"
        onClose={() => setDeleting(null)}
        onConfirm={() => api.deleteContent(deleting!.id)}
        onDone={() => { setDeleting(null); void client.invalidateQueries({ queryKey: ['content'] }); }}
      />
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
  const [deleting, setDeleting] = useState(false);

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
              label={hintLabel("Division", "Home ServiceGenius or Hospitality.")} allowDeselect={false} readOnly={!editable} value={item.division}
              data={[{ value: 'hsg', label: 'Home ServiceGenius' }, { value: 'hospitality', label: 'Hospitality' }]}
              onChange={(value) => setItem((c) => ({ ...c, division: value as Division, industry: industries.data?.find((i) => i.division === value)?.key }))}
            />
            <Select label={hintLabel("Industry", "Which industry's newsletters can use this story.")} placeholder="Choose an industry" allowDeselect={false} readOnly={!editable} value={item.industry ?? null} data={(industries.data ?? []).filter((i) => i.division === item.division).map((i) => ({ value: i.key, label: i.label }))} onChange={(value) => setItem((c) => ({ ...c, industry: value ?? undefined }))} />
            <TextInput label={hintLabel("Season", "Optional. When the story fits best, for example Fall.")} placeholder="e.g. Fall" readOnly={!editable} value={item.season ?? ''} onChange={field('season')} />
          </SimpleGrid>
          <TagsInput label={hintLabel("Regions", "Leave empty for every area. Add region codes such as US-CO to send it only to sub-accounts serving those regions. Press Enter after each one.")} placeholder="Type a region code, then press Enter (e.g. US-CO)" readOnly={!editable} value={item.regions ?? []} onChange={(regions) => setItem((c) => ({ ...c, regions }))} />
          <TextInput label={hintLabel("Headline", "The story's title.")} placeholder="What to check on your roof after a storm" required readOnly={!editable} value={item.headline ?? ''} onChange={field('headline')} />
          <Textarea label={hintLabel("Teaser", "One or two sentences that make readers want to read the story.")} placeholder="One or two sentences that make readers want to open the story" readOnly={!editable} autosize minRows={2} value={item.teaser ?? ''} onChange={field('teaser')} />
          <Textarea label={hintLabel("Body", "The full story. Leave a blank line between paragraphs. Avoid unchecked statistics, guarantees, weather claims and sales language.")} placeholder="Write the article here. Leave a blank line between paragraphs." readOnly={!editable} autosize minRows={8} value={item.body ?? ''} onChange={field('body')} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={hintLabel("Image URL", "Optional. A public link to the story's picture.")} placeholder="https://yourcompany.com/images/roof-inspection.jpg" type="url" readOnly={!editable} value={item.image_url ?? ''} onChange={field('image_url')} />
            <TextInput label={hintLabel("Image alt text", "Describes the picture for people who use screen readers.")} placeholder="e.g. Roofer checking shingles after a storm" readOnly={!editable} value={item.image_alt ?? ''} onChange={field('image_alt')} />
            <TextInput label={hintLabel("Image license", "Where the picture comes from, for example your own photo or a stock licence and its ID. Needed before the story can be approved.")} placeholder="e.g. Own photo, or stock licence and ID" readOnly={!editable} value={item.image_license ?? ''} onChange={field('image_license')} />
            <TextInput label={hintLabel("Expires on", "Optional. The story stops appearing in newsletters after this date.")} type="date" readOnly={!editable} value={item.expires_at?.slice(0, 10) ?? ''} onChange={field('expires_at')} />
            <TextInput label={hintLabel("Button type", "The kind of button, for example assessment or booking.")} placeholder="e.g. assessment" readOnly={!editable} value={item.cta_class ?? ''} onChange={field('cta_class')} />
            <TextInput label={hintLabel("Button text", "The text on the button under the story, for example Schedule a roof assessment.")} placeholder="Schedule a roof assessment" readOnly={!editable} value={item.cta_label ?? ''} onChange={field('cta_label')} />
          </SimpleGrid>
          {editable && <Group justify="flex-end"><Button loading={busy} disabled={!item.headline?.trim()} onClick={() => void save()}>Save draft</Button></Group>}
        </Stack>
      </Paper>

      {id && canEdit(session?.role) && (
        <Paper withBorder p="md">
          <Title order={4} mb="sm">Approval workflow</Title>
          {NEXT_STEPS[status].length > 0 && <Textarea label={hintLabel("Notes", "A note for the next person who reviews this story.")} placeholder="What the next reviewer should know" autosize minRows={2} mb="sm" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />}
          <Group>
            {NEXT_STEPS[status].map((step) => (
              <Button key={step.to} variant={step.color === 'gray' ? 'default' : 'filled'} color={step.color} loading={busy} onClick={() => void run(() => api.advanceContent(id, step.to, notes || undefined), humanize(step.to))}>
                {step.label}
              </Button>
            ))}
            {(status === 'approved' || status === 'retired') && <Button variant="default" loading={busy} onClick={() => void newVersion()}>Create new version</Button>}
            {canDeleteStory(item) && <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} ml="auto" disabled={busy} onClick={() => setDeleting(true)}>Delete story</Button>}
          </Group>
        </Paper>
      )}
      <ConfirmDelete
        opened={deleting}
        title="Delete this story?"
        message={`“${item.headline || 'Untitled'}” (v${item.version ?? 1}) will be deleted. This cannot be undone.`}
        confirmLabel="Delete story"
        success="Story deleted"
        onClose={() => setDeleting(false)}
        onConfirm={() => api.deleteContent(id!)}
        onDone={() => { void client.invalidateQueries({ queryKey: ['content'] }); navigate('/admin/content', { replace: true }); }}
      />
    </Stack>
  );
}
