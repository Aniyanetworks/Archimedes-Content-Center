import { PageHeader } from '../components/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Checkbox, Group, Modal, MultiSelect, Paper, Radio, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { FilterBar } from '../components/FilterBar';
import { hintLabel } from '../components/HintLabel';
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
      showSuccess('Campaign deleted');
      await client.invalidateQueries({ queryKey: ['editions'] });
      onDeleted();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal opened={!!edition} onClose={onClose} title="Delete this campaign?">
      <Stack>
        <Text size="sm">
          “{edition?.subject || 'Untitled'}” ({edition ? `${humanize(edition.industry)}, week of ${formatDate(edition.publication_week)}` : ''}) will be deleted. Its stories stay in the content library. This cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button color="red" loading={busy} onClick={() => void remove()}>Delete campaign</Button>
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
      navigate(`/admin/campaigns/${id}`);
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
      <PageHeader title="Campaigns" description="Weekly industry campaigns. Approve one and every eligible sub-account gets a branded version." actions={<>{canEdit(session?.role) && <Button onClick={openNew}>New campaign</Button>}</>} />
      {editions.error && <Alert color="red">{(editions.error as Error).message}</Alert>}
      <Paper withBorder p="sm">
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search campaigns"
          tabs={statusTabs}
          tab={filterStatus}
          onTab={setFilterStatus}
          selects={[
            { key: 'industry', placeholder: 'All industries', value: filterIndustry, onChange: setFilterIndustry, data: industryOptions },
            { key: 'when', placeholder: 'Any week', value: filterWhen, onChange: setFilterWhen, data: [{ value: 'upcoming', label: 'This week and later' }, { value: 'past', label: 'Past weeks' }] },
          ]}
          total={all.length}
          shown={rows.length}
          noun={['campaign', 'campaigns']}
          onClear={clearFilters}
        />
        <ScrollArea>
          <Table highlightOnHover miw={680}>
            <Table.Thead><Table.Tr><Table.Th>Week of</Table.Th><Table.Th>Industry</Table.Th><Table.Th>Subject</Table.Th><Table.Th>Version</Table.Th><Table.Th>Status</Table.Th>{editor && <Table.Th aria-label="Actions" w={56} />}</Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((edition) => (
                <Table.Tr key={edition.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}><Anchor component={Link} to={`/admin/campaigns/${edition.id}`} size="sm" fw={600}>{formatDate(edition.publication_week)}</Anchor></Table.Td>
                  <Table.Td>{humanize(edition.industry)}</Table.Td>
                  <Table.Td>{edition.subject || 'Untitled'}</Table.Td>
                  <Table.Td>v{edition.version}</Table.Td>
                  <Table.Td><Badge variant="light" color={EDITION_COLORS[edition.status]}>{humanize(edition.status)}</Badge></Table.Td>
                  {editor && (
                    <Table.Td>
                      {canDelete(edition) && (
                        <ActionIcon variant="subtle" color="red" aria-label={`Delete ${edition.subject || 'campaign'}`} title="Delete campaign" onClick={() => setDeleting(edition)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
              {!editions.isLoading && rows.length === 0 && <Table.Tr><Table.Td colSpan={editor ? 6 : 5}><Text c="dimmed" ta="center" py="lg">{filtering ? 'No campaigns match these filters.' : 'No campaigns yet.'}</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <DeleteEditionModal edition={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
      <Modal opened={creating} onClose={() => setCreating(false)} title="New campaign">
        <Stack>
          <Select label="Industry" placeholder="Choose an industry" allowDeselect={false} value={industry} onChange={changeIndustry} data={(industries.data ?? []).map((i) => ({ value: i.key, label: i.label }))} />
          <TextInput label={hintLabel('Publication week', 'The Monday of the week this newsletter is for. Each sub-account sends it on its own chosen day that week.')} type="date" error={!weekIsMonday ? 'Pick a Monday' : existing ? `${industryLabel} already has a campaign this week` : undefined} value={week} onChange={(e) => setWeek(e.currentTarget.value)} />
          {existing && (
            <Alert color="blue" p="sm">
              Each industry has one campaign per week. <Anchor component="button" type="button" size="sm" onClick={() => navigate(`/admin/campaigns/${existing.id}`)}>Open “{existing.subject || 'Untitled'}”</Anchor> or pick another week.
            </Alert>
          )}
          <TextInput label={hintLabel('Subject line', 'The subject people see in their inbox. Keep it short and specific.')} placeholder="What to check on your roof after a storm" value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
          <Button disabled={!weekIsMonday || !!existing || !subject.trim()} onClick={() => void create()}>Create campaign</Button>
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
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: api.listTenants });
  // Preview choices: which design, and whose branding (the example business or a real sub-account).
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [previewAs, setPreviewAs] = useState<string>('example');
  const previewTenant = useQuery({ queryKey: ['tenant', previewAs], queryFn: () => api.getTenant(previewAs), enabled: previewAs !== 'example' });

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
    const chosen = previewAs !== 'example' ? previewTenant.data : undefined;
    // A real sub-account's own design is used unless a design is picked by hand.
    const designKey = previewDesign ?? chosen?.prefs.template_key ?? templates.data?.[0]?.key;
    const template = templates.data?.find((x) => x.key === designKey) ?? templates.data?.[0];
    const heroStory = candidates.find((c) => c.id === hero);
    if (!template || !heroStory || !edition) return null;
    // Example branding only. Each tenant's real version is rendered by n8n after approval.
    const result = renderNewsletter({
      template_html: template.html,
      labels: template.labels,
      division: edition.division,
      edition: { ...edition, ...form },
      tenant: { division: edition.division },
      brand: chosen ? { ...chosen.brand } : sampleIssue(edition.division, settings.data).brand,
      offer: chosen?.brand.offer_approved && chosen.brand.offer_headline ? { headline: chosen.brand.offer_headline, body: chosen.brand.offer_body ?? '', cta_label: chosen.brand.offer_cta_label ?? '', url: chosen.brand.offer_url ?? '' } : undefined,
      hero: heroStory,
      secondary: secondary.map((sid) => candidates.find((c) => c.id === sid)).filter(Boolean),
    });
    return { html: result.html as string | null, errors: (result.errors as string[] | undefined) ?? [], design: template?.name };
  }, [templates.data, candidates, hero, secondary, edition, form, settings.data, previewDesign, previewAs, previewTenant.data]);

  if (detail.error) return <Alert color="red" title="Could not load this campaign">{(detail.error as Error).message}</Alert>;
  if (!edition) return <Text c="dimmed">Loading…</Text>;
  const division = edition.division;

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>{humanize(edition.industry)} campaign</Title>
          <Text c="dimmed" size="sm">Week of {formatDate(edition.publication_week)} · v{edition.version}</Text>
        </div>
        <Badge size="lg" variant="light" color={EDITION_COLORS[edition.status]}>{humanize(edition.status)}</Badge>
      </Group>

      {edition.status === 'approved' && (
        <Alert color="blue">This campaign is centrally approved. Saving any change sends it back to draft, creates a new version, and requires approval again.</Alert>
      )}
      {edition.notes && <Alert color="yellow" title="Notes">{edition.notes}</Alert>}

      <Paper withBorder p="md">
        <Title order={4} mb="sm">Details</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={hintLabel('Subject line', 'The subject people see in their inbox. Keep it short and specific.')} placeholder="What to check on your roof after a storm" disabled={!editor} value={form.subject ?? ''} onChange={(e) => { const subject = e.currentTarget.value; setForm((c) => ({ ...c, subject })); }} />
          <TextInput label={hintLabel('Preview text', 'The short line most inboxes show after the subject. Use it to add a reason to open the email.')} placeholder="A ten-minute walk-around that can save you a costly repair" disabled={!editor} value={form.preview_text ?? ''} onChange={(e) => { const preview_text = e.currentTarget.value; setForm((c) => ({ ...c, preview_text })); }} />
          <MultiSelect label={hintLabel('Eligible plans', 'Which plans get this campaign. Leave it empty to send it to every plan in this division.')} placeholder="All plans in this division" disabled={!editor} value={form.eligible_plans ?? []} data={(plans.data ?? []).filter((p) => p.division === division).map((p) => ({ value: p.plan_key, label: p.label }))} onChange={(eligible_plans) => setForm((c) => ({ ...c, eligible_plans }))} />
          <SimpleGrid cols={2}>
            <TextInput label={hintLabel('Embargo until', 'Optional. Nothing is sent before this date, even if the send time comes earlier.')} type="date" disabled={!editor} value={form.embargo_at?.slice(0, 10) ?? ''} onChange={(e) => { const embargo_at = e.currentTarget.value; setForm((c) => ({ ...c, embargo_at })); }} />
            <TextInput label={hintLabel('Expires on', 'Optional. Nothing is sent after this date, for example when the content would be out of date.')} type="date" disabled={!editor} value={form.expires_at?.slice(0, 10) ?? ''} onChange={(e) => { const expires_at = e.currentTarget.value; setForm((c) => ({ ...c, expires_at })); }} />
          </SimpleGrid>
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md">
        <Title order={4} mb="sm">{hintLabel('Stories', `Only approved ${humanize(edition.industry).toLowerCase()} stories are listed. A story limited to certain regions is left out for sub-accounts outside those regions.`)}</Title>
        {candidates.length === 0 ? <Text c="dimmed" size="sm">No approved stories for this industry yet.</Text> : (
          <ScrollArea>
            <Table miw={620}>
              <Table.Thead><Table.Tr><Table.Th>{hintLabel('Main', 'The main story at the top of the newsletter. Pick exactly one.')}</Table.Th><Table.Th>{hintLabel('Extra', 'Shorter stories under the main one. Pick as many as you like.')}</Table.Th><Table.Th>Story</Table.Th><Table.Th>{hintLabel('Regions', 'All means the story suits every area. Otherwise only sub-accounts serving those regions get it.')}</Table.Th></Table.Tr></Table.Thead>
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
        <Group justify="space-between" align="flex-end" mb="sm" gap="sm">
          <Title order={4}>{hintLabel('Preview', "See this week's stories in any design, with the example business or a real sub-account's branding. Each sub-account's own newsletter is made after approval, in its own design.")}</Title>
          <Group gap="sm" align="flex-end">
            <Select size="sm" w={240} label="Show as" allowDeselect={false} value={previewAs} onChange={(v) => { setPreviewAs(v ?? 'example'); setPreviewDesign(null); }}
              data={[{ value: 'example', label: 'Example business' }, ...(tenants.data ?? []).filter((x) => x.industry === edition.industry).map((x) => ({ value: x.id, label: x.name }))]} />
            <Select size="sm" w={240} label="Design" allowDeselect={false} value={previewDesign ?? (previewAs !== 'example' ? previewTenant.data?.prefs.template_key ?? null : null) ?? templates.data?.[0]?.key ?? null}
              onChange={setPreviewDesign} data={(templates.data ?? []).map((x) => ({ value: x.key, label: x.is_custom ? `${x.name} (custom)` : x.name }))} />
          </Group>
        </Group>
        {previewHtml && !previewHtml.html && previewHtml.errors.length > 0
          ? <Alert color="orange">This sub-account is missing details needed for a newsletter ({previewHtml.errors.map((e) => humanize(e)).join(', ')}). Fill them in on its page to see the preview.</Alert>
          : <EmailPreview html={previewHtml?.html ?? null} height={520} />}
      </Paper>

      {editor && (
        <Group justify="flex-end">
          {canDelete(edition) && (
            <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} disabled={busy} onClick={() => setDeleting(true)} mr="auto">Delete campaign</Button>
          )}
          <Button variant="default" loading={busy} onClick={() => void run(saveAll, 'Campaign saved')}>Save</Button>
          {(edition.status === 'draft' || edition.status === 'rejected') && (
            <Button loading={busy} disabled={!hero} onClick={() => void run(async () => { await saveAll(); await api.submitEdition(id); }, 'Submitted for approval')}>Submit for approval</Button>
          )}
          {edition.status === 'pending_approval' && (
            <>
              <Button color="red" variant="light" loading={busy} onClick={() => setRejectOpen(true)}>Reject</Button>
              <Button color="green" loading={busy} onClick={() => void run(() => api.approveEdition(id), 'Campaign approved. Sub-account newsletters are being queued.')}>Approve and publish</Button>
            </>
          )}
        </Group>
      )}

      <DeleteEditionModal edition={deleting ? edition : null} onClose={() => setDeleting(false)} onDeleted={() => navigate('/admin/campaigns', { replace: true })} />
      <Modal opened={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject campaign">
        <Stack>
          <Textarea label="Notes for the editor" placeholder="What needs to change before this can be approved" required autosize minRows={3} value={rejectNotes} onChange={(e) => setRejectNotes(e.currentTarget.value)} />
          <Button color="red" disabled={!rejectNotes.trim()} onClick={() => { setRejectOpen(false); void run(() => api.rejectEdition(id, rejectNotes.trim()), 'Campaign rejected'); }}>Reject campaign</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
