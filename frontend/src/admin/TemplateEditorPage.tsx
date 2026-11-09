import { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Checkbox, Group, List, Menu, Paper, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Textarea, ThemeIcon, Title } from '@mantine/core';
import { IconCheck, IconChevronDown, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Division, TemplateInfo } from '../api/types';
import { EmailPreview } from '../components/EmailPreview';
import { hintLabel } from '../components/HintLabel';
import { PageHeader } from '../components/PageHeader';
import { renderNewsletter } from '../lib/render.js';
import { sampleIssue } from '../lib/sampleContent';
import { showError, showSuccess } from '../lib/util';
import { useAuth } from './AuthContext';

// What a template can use. Anything else in [[double brackets]] comes out empty.
const PLACEHOLDERS: Array<{ group: string; items: Array<[string, string]> }> = [
  { group: 'Business and brand', items: [
    ['[[newsletter_name]]', 'Newsletter title'], ['[[logo_url]]', 'Logo link (inside [[#logo_url]]…[[/logo_url]])'], ['[[primary_color]]', 'Main colour'], ['[[secondary_color]]', 'Accent colour'],
    ['[[phone]]', 'Phone'], ['[[website]]', 'Website'], ['[[local_note]]', 'Local note'],
  ] },
  { group: 'This issue', items: [
    ['[[edition_subject]]', 'Subject line'], ['[[preview_text]]', 'Inbox preview text'],
    ['[[hero_headline]]', 'Main story headline'], ['[[hero_body_html]]', 'Main story text'], ['[[hero_image_url]]', 'Main story picture'],
    ['[[hero_cta_label]]', 'Main story button text'], ['[[hero_cta_url]]', 'Main story button link'],
    ['[[#secondary]]…[[/secondary]]', 'Repeats once per extra story: [[headline]], [[teaser]], [[cta_label]], [[cta_url]], [[image_url]]'],
    ['[[offer_headline]]', 'Offer headline'], ['[[offer_body]]', 'Offer text'], ['[[offer_cta_label]]', 'Offer button text'], ['[[offer_url]]', 'Offer link'],
  ] },
  { group: 'Labels (set below for each business type)', items: [
    ['[[hero_kicker]]', 'Small heading above the main story'], ['[[secondary_heading]]', 'Heading above extra stories'], ['[[local_heading]]', 'Heading for the local note'],
    ['[[offer_heading]]', 'Heading for the offer'], ['[[footer_reason]]', 'Why the reader gets this email'],
  ] },
  { group: 'Required footer', items: [
    ['[[legal_business_name]]', 'Legal business name (required)'], ['[[postal_address]]', 'Postal address (required)'], ['[[unsubscribe_html]]', 'Unsubscribe link (required)'],
  ] },
];

const KNOWN = new Set([
  'newsletter_name', 'edition_subject', 'preview_text', 'logo_url', 'primary_color', 'secondary_color', 'legal_business_name', 'postal_address', 'phone', 'phone_url', 'website',
  'social', 'social_name', 'social_url', 'local_note', 'hero_headline', 'hero_teaser', 'hero_body_html', 'hero_image_url', 'hero_image_alt', 'hero_cta_label', 'hero_cta_url',
  'secondary', 'headline', 'teaser', 'body_html', 'image_url', 'image_alt', 'cta_label', 'cta_url', 'offer_headline', 'offer_body', 'offer_cta_label', 'offer_url', 'unsubscribe_html',
  'hero_kicker', 'secondary_heading', 'local_heading', 'offer_heading', 'footer_reason',
]);

const LABEL_FIELDS: Array<[string, string]> = [
  ['hero_kicker', 'Main story heading'], ['secondary_heading', 'Extra stories heading'], ['local_heading', 'Local note heading'],
  ['offer_heading', 'Offer heading'], ['footer_reason', 'Why they get this email'],
];

const REQUIRED: Array<[string, string]> = [
  ['[[unsubscribe_html]]', 'Unsubscribe link'],
  ['data-slot="legal"', 'Legal footer block (data-slot="legal")'],
  ['[[legal_business_name]]', 'Legal business name'],
  ['[[postal_address]]', 'Postal address'],
];

type Labels = TemplateInfo['labels'];

export function TemplateEditorPage() {
  const { key } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { session } = useAuth();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const editing = templates.data?.find((t) => t.key === key);

  const [from, setFrom] = useState<string | null>(params.get('from'));
  const [name, setName] = useState('');
  const [html, setHtml] = useState('');
  const [labels, setLabels] = useState<Labels>({ hsg: {}, hospitality: {} });
  const [chosenPlans, setChosenPlans] = useState<string[]>([]);
  const [division, setDivision] = useState<Division>('hsg');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  // Fill the form once: from the template being edited, or from the design being copied.
  useEffect(() => {
    if (loaded || !templates.data || !plans.data) return;
    const source = key ? editing : templates.data.find((t) => t.key === (from ?? templates.data[0]?.key));
    if (!source) return;
    setHtml(source.html);
    setLabels(JSON.parse(JSON.stringify(source.labels ?? { hsg: {}, hospitality: {} })));
    setName(key ? source.name : `${source.name} (copy)`);
    setChosenPlans(plans.data.filter((p) => p.template_keys.includes(source.key)).map((p) => p.plan_key));
    if (!key) setFrom(source.key);
    setLoaded(true);
  }, [loaded, templates.data, plans.data, key, editing, from]);

  function startFrom(next: string | null) {
    const source = templates.data?.find((t) => t.key === next);
    if (!source) return;
    setFrom(next);
    setHtml(source.html);
    setLabels(JSON.parse(JSON.stringify(source.labels ?? {})));
    if (!name || name.endsWith('(copy)')) setName(`${source.name} (copy)`);
  }

  function insert(text: string) {
    const area = editor.current;
    const snippet = text.includes('…') ? text.replace('…', '') : text;
    if (!area) { setHtml((current) => current + snippet); return; }
    const start = area.selectionStart ?? html.length;
    const end = area.selectionEnd ?? start;
    const next = html.slice(0, start) + snippet + html.slice(end);
    setHtml(next);
    requestAnimationFrame(() => { area.focus(); area.selectionStart = area.selectionEnd = start + snippet.length; });
  }

  const issue = sampleIssue(division, settings.data);
  const preview = useMemo(() => renderNewsletter({
    template_html: html, labels, division, edition: { subject: issue.subject, preview_text: issue.preview_text },
    tenant: { division }, brand: issue.brand, hero: issue.hero, secondary: issue.secondary, offer: issue.offer,
  }), [html, labels, division, issue]);

  const missing = REQUIRED.filter(([needle]) => !html.includes(needle));
  const unknown = [...new Set([...html.matchAll(/\[\[[#/]?([\w.]+)\]\]/g)].map((m) => m[1]).filter((k) => !KNOWN.has(k)))];
  const renderProblem = (preview.errors as string[] | undefined)?.includes('unresolved_template_slot') ? 'A [[#section]] is not closed with a matching [[/section]].' : null;
  const canSave = !!name.trim() && !!html.trim() && missing.length === 0 && !renderProblem;

  async function save() {
    setSaving(true);
    try {
      const savedKey = await api.saveCustomTemplate({ key: key ?? null, name: name.trim(), html, labels, plans: chosenPlans });
      await client.invalidateQueries({ queryKey: ['templates'] });
      await client.invalidateQueries({ queryKey: ['plans'] });
      showSuccess(key ? 'Template updated. New newsletters use this version.' : 'Template created.');
      navigate(`/admin/templates?design=${savedKey}`);
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }

  if (session?.role !== 'admin') return <Alert color="gray">Only admins can create or edit templates.</Alert>;
  if (key && templates.data && !editing) return <Alert color="red">This template no longer exists.</Alert>;
  if (editing && !editing.is_custom) return <Alert color="orange">The built-in designs cannot be edited. <Link to={`/admin/templates/new?from=${editing.key}`}>Copy it as a new template</Link> instead.</Alert>;

  return (
    <Stack>
      <PageHeader
        title={key ? `Edit ${editing?.name ?? 'template'}` : 'New template'}
        description={key ? `Saving publishes version ${(editing?.version ?? 0) + 1}. Newsletters already made keep the version they used.` : 'Start from an existing design, then change its HTML.'}
        actions={<>
          <Button variant="default" component={Link} to="/admin/templates">Cancel</Button>
          <Button loading={saving} disabled={!canSave} onClick={() => void save()}>{key ? 'Save new version' : 'Create template'}</Button>
        </>}
      />

      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, md: key ? 2 : 3 }} className="field-grid">
          <TextInput label={hintLabel('Name', 'What staff see in the design list, for example "Winter Spotlight".')} placeholder="e.g. Winter Spotlight" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
          {!key && (
            <Select label={hintLabel('Start from', 'The design to copy. Changing this replaces the HTML and labels below.')} allowDeselect={false} value={from}
              data={(templates.data ?? []).map((t) => ({ value: t.key, label: t.is_custom ? `${t.name} (custom)` : t.name }))} onChange={startFrom} />
          )}
          <div>
            <Text size="sm" fw={500} mb={6}>{hintLabel('Plans that can use it', 'Sub-accounts on these plans can choose this design. With none ticked, nobody can use it yet.')}</Text>
            <Group gap="md">
              {(plans.data ?? []).map((p) => (
                <Checkbox key={p.plan_key} label={p.label} checked={chosenPlans.includes(p.plan_key)}
                  onChange={(e) => { const on = e.currentTarget.checked; setChosenPlans((c) => (on ? [...c, p.plan_key] : c.filter((x) => x !== p.plan_key))); }} />
              ))}
            </Group>
          </div>
        </SimpleGrid>
        <Accordion variant="separated" mt="md" chevronPosition="left">
          <Accordion.Item value="labels">
            <Accordion.Control>{hintLabel('Labels', 'Small headings the template shows, worded for each type of business. Use them in the HTML as [[hero_kicker]], [[secondary_heading]] and so on.')}</Accordion.Control>
            <Accordion.Panel>
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                {(['hsg', 'hospitality'] as const).map((d) => (
                  <Stack key={d} gap="xs">
                    <Text fw={600} size="sm">{d === 'hsg' ? 'Home ServiceGenius' : 'Hospitality'}</Text>
                    {LABEL_FIELDS.map(([field, label]) => (
                      <TextInput key={field} size="xs" label={label} value={labels[d]?.[field] ?? ''}
                        onChange={(e) => { const value = e.currentTarget.value; setLabels((c) => ({ ...c, [d]: { ...(c[d] ?? {}), [field]: value } })); }} />
                    ))}
                  </Stack>
                ))}
              </SimpleGrid>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs">
            <Title order={5}>{hintLabel('HTML', 'Email HTML. Use inline styles and tables for the best results in email apps. Placeholders in [[double brackets]] are filled in for each sub-account.')}</Title>
            <Menu shadow="md" width={420} position="bottom-end">
              <Menu.Target><Button size="xs" variant="light" rightSection={<IconChevronDown size={14} />}>Insert placeholder</Button></Menu.Target>
              <Menu.Dropdown>
                <ScrollArea.Autosize mah={420}>
                  {PLACEHOLDERS.map((group) => (
                    <div key={group.group}>
                      <Menu.Label>{group.group}</Menu.Label>
                      {group.items.map(([code, label]) => (
                        <Menu.Item key={code} onClick={() => insert(code)}>
                          <Text size="xs" ff="monospace">{code}</Text>
                          <Text size="xs" c="dimmed">{label}</Text>
                        </Menu.Item>
                      ))}
                    </div>
                  ))}
                </ScrollArea.Autosize>
              </Menu.Dropdown>
            </Menu>
          </Group>
          <Textarea ref={editor} aria-label="Template HTML" value={html} onChange={(e) => setHtml(e.currentTarget.value)} spellCheck={false}
            styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.5, height: 620, whiteSpace: 'pre', overflowWrap: 'normal' } }} />
          <Stack gap={6} mt="sm">
            <Text size="sm" fw={600}>Checks</Text>
            <List size="sm" spacing={4} center>
              {REQUIRED.map(([needle, label]) => {
                const ok = html.includes(needle);
                return (
                  <List.Item key={needle} icon={<ThemeIcon size={18} radius="xl" color={ok ? 'green' : 'red'}>{ok ? <IconCheck size={12} /> : <IconX size={12} />}</ThemeIcon>}>
                    {label}{!ok && <Text span c="red" size="xs"> · required, add it with Insert placeholder</Text>}
                  </List.Item>
                );
              })}
            </List>
            {renderProblem && <Alert color="red" p="xs">{renderProblem}</Alert>}
            {unknown.length > 0 && <Alert color="yellow" p="xs">Unknown placeholder{unknown.length > 1 ? 's' : ''} {unknown.map((u) => `[[${u}]]`).join(', ')}: {unknown.length > 1 ? 'these come' : 'this comes'} out empty.</Alert>}
            {chosenPlans.length === 0 && <Alert color="blue" p="xs">No plan is ticked, so no sub-account can choose this template yet.</Alert>}
          </Stack>
        </Paper>
        <Paper withBorder p="md" style={{ position: 'sticky', top: 76, alignSelf: 'start' }}>
          <Group justify="space-between" mb="xs">
            <Title order={5}>{hintLabel('Live preview', 'Filled with the example business from the Templates page. Updates as you type.')}</Title>
            <Group gap="xs">
              <Badge variant="light" color="gray">Example content</Badge>
              <SegmentedControl size="xs" value={division} onChange={(v) => setDivision(v as Division)} data={[{ value: 'hsg', label: 'Home services' }, { value: 'hospitality', label: 'Hospitality' }]} />
            </Group>
          </Group>
          {preview.html
            ? <EmailPreview html={preview.html} height={640} />
            : <Alert color="orange">The preview appears once the required footer pieces are in the HTML.</Alert>}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
