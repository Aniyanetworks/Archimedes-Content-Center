import { PageHeader } from '../components/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Checkbox, Group, Modal, MultiSelect, Paper, Radio, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { FilterBar } from '../components/FilterBar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Division, Edition, EditionItem, EditionStatus } from '../api/types';
import { EmailPreview } from '../components/EmailPreview';
import { renderNewsletter } from '../lib/render.js';
import { sampleIssue } from '../lib/sampleContent';
import { canEdit, formatDate, humanize, showError, showSuccess } from '../lib/util';
import { useAuth } from './AuthContext';

const EDITION_COLORS: Record<EditionStatus, string> = { draft: 'gray', pending_approval: 'yellow', approved: 'green', rejected: 'red' };

// Matches edition_delete in the database: only editions that were never approved and have no campaigns.
const canDelete = (edition: Edition) => edition.status !== 'approved' && !edition.central_approved_at;

function DeleteEditionModal({ edition, onClose, onDeleted }: { edition: Edition | null; onClose: () => void; onDeleted: () => void }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!edition) return;
    setBusy(true);
    try {
      await api.deleteEdition(edition.id);
      showSuccess('Edition deleted');
      await client.invalidateQueries({ queryKey: ['editions'] });
      onDeleted();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal opened={!!edition} onClose={onClose} title="Delete this edition?">
      <Stack>
        <Text size="sm">
          “{edition?.subject || 'Untitled'}” ({edition ? `${humanize(edition.industry)}, week of ${formatDate(edition.publication_week)}` : ''}) will be deleted. Its stories stay in the content library. This cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button color="red" loading={busy} onClick={() => void remove()}>Delete edition</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

// Each industry has one edition per week, so suggest the first week that is still free.
function nextFreeMonday(industry: string | null, editions: Edition[]): string {
  const taken = new Set(editions.filter((e) => e.industry === industry).map((e) => e.publication_week.slice(0, 10)));
  const date = new Date(`${nextMonday()}T00:00:00Z`);
  while (taken.has(date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

export function EditionListPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const editions = useQuery({ queryKey: ['editions'], queryFn: api.listEditions });
  const industries = useQuery({ queryKey: ['industries'], queryFn: api.listIndustries });
  const [creating, setCreating] = useState(false);
  const [industry, setIndustry] = useState<string | null>('roofing');
  const [week, setWeek] = useState(nextMonday());
  const [subject, setSubject] = useState('');
  const [deleting, setDeleting] = useState<Edition | null>(null);
  const editor = canEdit(session?.role);
  const [search, setSearch] = useState('');
  const [filterIndustry, setFilterIndustry] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterWhen, setFilterWhen] = useState<string | null>(null);

  const all = editions.data ?? [];
  // Only offer choices that some edition actually has, with a count for each status.
  const industryOptions = [...new Set(all.map((e) => e.industry))]
    .map((key) => ({ value: key, label: industries.data?.find((i) => i.key === key)?.label ?? humanize(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const statusTabs = (Object.keys(EDITION_COLORS) as EditionStatus[])
    .map((value) => ({ value, label: humanize(value), count: all.filter((e) => e.status === value).length }));
  const thisMonday = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  const words = search.trim().toLowerCase();
  const rows = all.filter((e) =>
    (!words || `${e.subject} ${e.preview_text}`.toLowerCase().includes(words))
    && (!filterIndustry || e.industry === filterIndustry)
    && (!filterStatus || e.status === filterStatus)
    && (!filterWhen || (filterWhen === 'upcoming' ? e.publication_week.slice(0, 10) >= thisMonday : e.publication_week.slice(0, 10) < thisMonday)));
  const filtering = !!(words || filterIndustry || filterStatus || filterWhen);
  const clearFilters = () => { setSearch(''); setFilterIndustry(null); setFilterStatus(null); setFilterWhen(null); };

  async function create() {
    try {
      const picked = industries.data?.find((i) => i.key === industry);
      const id = await api.saveEdition({ division: picked?.division as Division, industry: industry ?? undefined, publication_week: week, subject });
      navigate(`/admin/editions/${id}`);
    } catch (error) {
      showError(error);
    }
  }

  const weekIsMonday = new Date(`${week}T00:00:00Z`).getUTCDay() === 1;
  const existing = (editions.data ?? []).find((e) => e.industry === industry && e.publication_week.slice(0, 10) === week);
  const industryLabel = industries.data?.find((i) => i.key === industry)?.label ?? 'This industry';

  function openNew() {
    setWeek(nextFreeMonday(industry, editions.data ?? []));
    setCreating(true);
  }

  function changeIndustry(value: string | null) {
    setIndustry(value);
    setWeek(nextFreeMonday(value, editions.data ?? []));
  }

  return (
    <Stack>
      <PageHeader title="Editions" description="Weekly industry editions. Approve one and every eligible tenant gets a branded version." actions={<>{canEdit(session?.role) && <Button onClick={openNew}>New edition</Button>}</>} />
      {editions.error && <Alert color="red">{(editions.error as Error).message}</Alert>}
      <Paper withBorder p="sm">
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search editions"
          tabs={statusTabs}
          tab={filterStatus}
          onTab={setFilterStatus}
          selects={[
            { key: 'industry', placeholder: 'All industries', value: filterIndustry, onChange: setFilterIndustry, data: industryOptions },
            { key: 'when', placeholder: 'Any week', value: filterWhen, onChange: setFilterWhen, data: [{ value: 'upcoming', label: 'This week and later' }, { value: 'past', label: 'Past weeks' }] },
          ]}
          total={all.length}
          shown={rows.length}
          noun={['edition', 'editions']}
          onClear={clearFilters}
        />
        <ScrollArea>
          <Table highlightOnHover miw={680}>
            <Table.Thead><Table.Tr><Table.Th>Week of</Table.Th><Table.Th>Industry</Table.Th><Table.Th>Subject</Table.Th><Table.Th>Version</Table.Th><Table.Th>Status</Table.Th>{editor && <Table.Th aria-label="Actions" w={56} />}</Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((edition) => (
                <Table.Tr key={edition.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}><Anchor component={Link} to={`/admin/editions/${edition.id}`} size="sm" fw={600}>{formatDate(edition.publication_week)}</Anchor></Table.Td>
                  <Table.Td>{humanize(edition.industry)}</Table.Td>
                  <Table.Td>{edition.subject || 'Untitled'}</Table.Td>
                  <Table.Td>v{edition.version}</Table.Td>
                  <Table.Td><Badge variant="light" color={EDITION_COLORS[edition.status]}>{humanize(edition.status)}</Badge></Table.Td>
                  {editor && (
                    <Table.Td>
                      {canDelete(edition) && (
                        <ActionIcon variant="subtle" color="red" aria-label={`Delete ${edition.subject || 'edition'}`} title="Delete edition" onClick={() => setDeleting(edition)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
              {!editions.isLoading && rows.length === 0 && <Table.Tr><Table.Td colSpan={editor ? 6 : 5}><Text c="dimmed" ta="center" py="lg">{filtering ? 'No editions match these filters.' : 'No editions yet.'}</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <DeleteEditionModal edition={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
      <Modal opened={creating} onClose={() => setCreating(false)} title="New edition">
        <Stack>
          <Select label="Industry" placeholder="Choose an industry" allowDeselect={false} value={industry} onChange={changeIndustry} data={(industries.data ?? []).map((i) => ({ value: i.key, label: i.label }))} />
          <TextInput label="Publication week" description="The Monday of the week" type="date" error={!weekIsMonday ? 'Pick a Monday' : existing ? `${industryLabel} already has an edition this week` : undefined} value={week} onChange={(e) => setWeek(e.currentTarget.value)} />
          {existing && (
            <Alert color="blue" p="sm">
              Each industry has one edition per week. <Anchor component="button" type="button" size="sm" onClick={() => navigate(`/admin/editions/${existing.id}`)}>Open “{existing.subject || 'Untitled'}”</Anchor> or pick another week.
            </Alert>
          )}
          <TextInput label="Subject line" placeholder="What to check on your roof after a storm" value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
          <Button disabled={!weekIsMonday || !!existing || !subject.trim()} onClick={() => void create()}>Create edition</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function EditionDetailPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const detail = useQuery({ queryKey: ['edition', id], queryFn: () => api.getEdition(id) });
  const content = useQuery({ queryKey: ['content'], queryFn: api.listContent });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  const [form, setForm] = useState<Partial<Edition>>({});
  const [items, setItems] = useState<EditionItem[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    setForm(detail.data.edition);
    setItems(detail.data.items);
  }, [detail.data]);

  const edition = detail.data?.edition;
  const editor = canEdit(session?.role);

  // Only approved stories from this edition's own industry can be selected, so a brewery edition can never carry roofing content.
  const candidates = useMemo(
    () => (content.data ?? []).filter((c) => edition && c.status === 'approved' && c.division === edition.division && c.industry === edition.industry),
    [content.data, edition],
  );
  const hero = items.find((item) => item.slot === 'hero')?.content_item_id ?? null;
  const secondary = items.filter((item) => item.slot === 'secondary').map((item) => item.content_item_id);

  function select(contentId: string, slot: 'hero' | 'secondary' | null) {
    setItems((current) => {
      let next = current.filter((item) => item.content_item_id !== contentId);
      if (slot === 'hero') next = next.filter((item) => item.slot !== 'hero');
      if (slot) next = [...next, { content_item_id: contentId, slot, position: next.length }];
      return next.map((item, position) => ({ ...item, position }));
    });
  }

  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await work();
      showSuccess(message);
      await client.invalidateQueries();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  const saveAll = async () => {
    await api.saveEdition({ id, subject: form.subject, preview_text: form.preview_text, eligible_plans: form.eligible_plans, embargo_at: form.embargo_at || null, expires_at: form.expires_at || null });
    await api.setEditionItems(id, items);
  };

  const previewHtml = useMemo(() => {
    const template = templates.data?.[0];
    const heroStory = candidates.find((c) => c.id === hero);
    if (!template || !heroStory || !edition) return null;
    // Example branding only. Each tenant's real version is rendered by n8n after approval.
    const result = renderNewsletter({
      template_html: template.html,
      labels: template.labels,
      division: edition.division,
      edition: { ...edition, ...form },
      tenant: { division: edition.division },
      brand: sampleIssue(edition.division, settings.data).brand,
      hero: heroStory,
      secondary: secondary.map((sid) => candidates.find((c) => c.id === sid)).filter(Boolean),
    });
    return result.html as string | null;
  }, [templates.data, candidates, hero, secondary, edition, form, settings.data]);

  if (detail.error) return <Alert color="red" title="Could not load this edition">{(detail.error as Error).message}</Alert>;
  if (!edition) return <Text c="dimmed">Loading…</Text>;
  const division = edition.division;

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>{humanize(edition.industry)} edition</Title>
          <Text c="dimmed" size="sm">Week of {formatDate(edition.publication_week)} · v{edition.version}</Text>
        </div>
        <Badge size="lg" variant="light" color={EDITION_COLORS[edition.status]}>{humanize(edition.status)}</Badge>
      </Group>

      {edition.status === 'approved' && (
        <Alert color="blue">This edition is centrally approved. Saving any change sends it back to draft, creates a new version, and requires approval again.</Alert>
      )}
      {edition.notes && <Alert color="yellow" title="Notes">{edition.notes}</Alert>}

      <Paper withBorder p="md">
        <Title order={4} mb="sm">Details</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Subject line" placeholder="What to check on your roof after a storm" disabled={!editor} value={form.subject ?? ''} onChange={(e) => { const subject = e.currentTarget.value; setForm((c) => ({ ...c, subject })); }} />
          <TextInput label="Preview text" placeholder="A ten-minute walk-around that can save you a costly repair" description="The line inboxes show after the subject" disabled={!editor} value={form.preview_text ?? ''} onChange={(e) => { const preview_text = e.currentTarget.value; setForm((c) => ({ ...c, preview_text })); }} />
          <MultiSelect label="Eligible plans" placeholder="All plans in this division" description="Leave empty for every plan in this division" disabled={!editor} value={form.eligible_plans ?? []} data={(plans.data ?? []).filter((p) => p.division === division).map((p) => ({ value: p.plan_key, label: p.label }))} onChange={(eligible_plans) => setForm((c) => ({ ...c, eligible_plans }))} />
          <SimpleGrid cols={2}>
            <TextInput label="Embargo until" description="Not sent before this date" type="date" disabled={!editor} value={form.embargo_at?.slice(0, 10) ?? ''} onChange={(e) => { const embargo_at = e.currentTarget.value; setForm((c) => ({ ...c, embargo_at })); }} />
            <TextInput label="Expires on" description="Not sent after this date" type="date" disabled={!editor} value={form.expires_at?.slice(0, 10) ?? ''} onChange={(e) => { const expires_at = e.currentTarget.value; setForm((c) => ({ ...c, expires_at })); }} />
          </SimpleGrid>
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md">
        <Title order={4}>Stories</Title>
        <Text size="sm" c="dimmed" mb="sm">Approved {humanize(edition.industry).toLowerCase()} stories only. Region-specific stories are dropped for tenants outside those regions at render time.</Text>
        {candidates.length === 0 ? <Text c="dimmed" size="sm">No approved stories for this industry yet.</Text> : (
          <ScrollArea>
            <Table miw={620}>
              <Table.Thead><Table.Tr><Table.Th>Hero</Table.Th><Table.Th>Secondary</Table.Th><Table.Th>Story</Table.Th><Table.Th>Regions</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {candidates.map((story) => (
                  <Table.Tr key={story.id}>
                    <Table.Td><Radio aria-label={`Use ${story.headline} as hero`} disabled={!editor} checked={hero === story.id} onChange={() => select(story.id, 'hero')} /></Table.Td>
                    <Table.Td><Checkbox aria-label={`Use ${story.headline} as secondary`} disabled={!editor || hero === story.id} checked={secondary.includes(story.id)} onChange={(e) => select(story.id, e.currentTarget.checked ? 'secondary' : null)} /></Table.Td>
                    <Table.Td><Text size="sm" fw={600}>{story.headline}</Text><Text size="xs" c="dimmed">v{story.version} · {story.teaser}</Text></Table.Td>
                    <Table.Td>{story.regions.join(', ') || 'All'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Paper>

      <Paper withBorder p="md">
        <Title order={4} mb="sm">Preview with example branding</Title>
        <Text size="xs" c="dimmed" mb="xs">Uses placeholder branding to check the content. Each tenant's real version is rendered after approval.</Text>
        <EmailPreview html={previewHtml} height={520} />
      </Paper>

      {editor && (
        <Group justify="flex-end">
          {canDelete(edition) && (
            <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} disabled={busy} onClick={() => setDeleting(true)} mr="auto">Delete edition</Button>
          )}
          <Button variant="default" loading={busy} onClick={() => void run(saveAll, 'Edition saved')}>Save</Button>
          {(edition.status === 'draft' || edition.status === 'rejected') && (
            <Button loading={busy} disabled={!hero} onClick={() => void run(async () => { await saveAll(); await api.submitEdition(id); }, 'Submitted for approval')}>Submit for approval</Button>
          )}
          {edition.status === 'pending_approval' && (
            <>
              <Button color="red" variant="light" loading={busy} onClick={() => setRejectOpen(true)}>Reject</Button>
              <Button color="green" loading={busy} onClick={() => void run(() => api.approveEdition(id), 'Edition approved. Tenant campaigns are being queued.')}>Approve and publish</Button>
            </>
          )}
        </Group>
      )}

      <DeleteEditionModal edition={deleting ? edition : null} onClose={() => setDeleting(false)} onDeleted={() => navigate('/admin/editions', { replace: true })} />
      <Modal opened={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject edition">
        <Stack>
          <Textarea label="Notes for the editor" placeholder="What needs to change before this can be approved" required autosize minRows={3} value={rejectNotes} onChange={(e) => setRejectNotes(e.currentTarget.value)} />
          <Button color="red" disabled={!rejectNotes.trim()} onClick={() => { setRejectOpen(false); void run(() => api.rejectEdition(id, rejectNotes.trim()), 'Edition rejected'); }}>Reject edition</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
