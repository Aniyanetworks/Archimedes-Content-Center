import { PageHeader } from '../components/PageHeader';
import { useState } from 'react';
import { ActionIcon, Badge, Button, ColorInput, Divider, Group, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconCode, IconCopy, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { ImageInput } from '../components/ImageInput';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { EmailPreview } from '../components/EmailPreview';
import { renderNewsletter } from '../lib/render.js';
import { SAMPLE_ISSUES, sampleIssue, sampleSettingKey, type SampleIssue, type SampleStory } from '../lib/sampleContent';
import { canEdit, showError, showSuccess } from '../lib/util';
import type { Division } from '../api/types';
import { useAuth } from './AuthContext';
import { hintLabel } from '../components/HintLabel';
import type { Plan } from '../api/types';

const CADENCE_WORDS: Record<string, string> = { weekly: 'Every week', biweekly: 'Every 2 weeks' };

// Built from the plan itself, so the hint stays right when a plan changes.
function planHint(plan: Plan) {
  const often = plan.allowed_cadences.map((c) => CADENCE_WORDS[c] ?? c).join(' or ');
  return (
    <Stack gap={2}>
      <div><b>For:</b> {plan.division === 'hospitality' ? 'Hospitality businesses, such as breweries' : 'Home-service businesses'}</div>
      <div><b>How often:</b> {often}</div>
      <div><b>Designs:</b> {plan.template_keys.length} of 5 (the ticks below)</div>
      {plan.signoff_pending && <div><b>Not final yet:</b> only test emails can be sent on this plan.</div>}
    </Stack>
  );
}

const MAX_EXTRA_STORIES = 4;
const clone = (issue: SampleIssue): SampleIssue => JSON.parse(JSON.stringify(issue));

export function TemplatesPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.listPlans });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('design'));
  const [removing, setRemoving] = useState(false);
  const admin = session?.role === 'admin';
  const [division, setDivision] = useState<Division>('hsg');
  const [draft, setDraft] = useState<SampleIssue | null>(null);
  const [saving, setSaving] = useState(false);

  const list = templates.data ?? [];
  const template = list.find((t) => t.key === selected) ?? list[0];
  const saved = sampleIssue(division, settings.data);
  const customised = !!settings.data?.[sampleSettingKey(division)];
  const issue = draft ?? saved;
  const editable = canEdit(session?.role);
  const rendered = template
    ? renderNewsletter({ template_html: template.html, labels: template.labels, division, edition: { subject: issue.subject, preview_text: issue.preview_text }, tenant: { division }, brand: issue.brand, hero: issue.hero, secondary: issue.secondary, offer: issue.offer })
    : null;

  const update = (change: (next: SampleIssue) => void) => setDraft((current) => {
    const next = clone(current ?? saved);
    change(next);
    return next;
  });
  const setBrand = (key: string, value: string) => update((n) => { n.brand[key] = value; });
  const setHero = (key: keyof SampleStory, value: string) => update((n) => { n.hero[key] = value; });
  const setExtra = (index: number, key: keyof SampleStory, value: string) => update((n) => { n.secondary[index][key] = value; });
  const setOffer = (key: keyof SampleIssue['offer'], value: string) => update((n) => { n.offer[key] = value; });

  async function persist(value: SampleIssue | null, message: string) {
    setSaving(true);
    try {
      await api.setTemplateSample(division, value);
      await client.invalidateQueries({ queryKey: ['settings'] });
      setDraft(null);
      showSuccess(message);
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack>
      <PageHeader
        title="Templates"
        description="The newsletter designs. Clients choose a design, never the HTML. Admins can add their own designs with the HTML editor."
        actions={admin ? <Button leftSection={<IconPlus size={16} />} component={Link} to="/admin/templates/new">New template</Button> : undefined}
      />
      <Group>
        <Badge color="yellow" variant="light" size="lg" style={{ textTransform: 'none', fontWeight: 600 }}>
          {hintLabel('Waiting for Archimedes approval', (
            <Stack gap={4}>
              <div>• The five design names are temporary and can still change.</div>
              <div>• Which two designs the HSG Essentials plan gets is a first guess.</div>
              <div>• Before approving, compare the Homeowner Protection Report with the original Equinox email it was copied from.</div>
            </Stack>
          ))}
        </Badge>
      </Group>

      <Paper withBorder p="sm">
        <Title order={4} mb="xs">{hintLabel('Plan entitlements', 'Which designs each plan can use. A tick means sub-accounts on that plan can choose the design. "Not included" means they cannot.')}</Title>
        <ScrollArea>
          <Table miw={720}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{hintLabel('Design', 'The look of the newsletter. There are five to choose from.')}</Table.Th>
                <Table.Th>{hintLabel('Version', 'The current version of this design. The number goes up each time the design is updated.')}</Table.Th>
                {(plans.data ?? []).map((plan) => <Table.Th key={plan.plan_key}>{hintLabel(plan.label, planHint(plan))}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((t) => (
                <Table.Tr key={t.key}>
                  <Table.Td fw={600}>{t.name}{t.is_custom && <Badge ml={6} size="xs" variant="light" color="grape">Custom</Badge>}</Table.Td>
                  <Table.Td>v{t.version}</Table.Td>
                  {(plans.data ?? []).map((plan) => (
                    <Table.Td key={plan.plan_key}>
                      {plan.template_keys.includes(t.key) ? <IconCheck size={16} color="var(--mantine-color-green-7)" aria-label="Included" /> : <Tooltip label={`Sub-accounts on ${plan.label} can't choose this design. Move them to a plan with a tick here to use it.`} multiline w={240} withArrow><Text span c="dimmed" size="sm">Not included</Text></Tooltip>}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <Paper withBorder p="md">
        <Group align="flex-end" mb="sm" gap="sm">
          <Select style={{ flex: 1, minWidth: 180 }} label="Design" allowDeselect={false} value={template?.key ?? null} onChange={setSelected} data={list.map((t) => ({ value: t.key, label: t.is_custom ? `${t.name} (custom)` : t.name }))} />
          <Select
            style={{ flex: 1, minWidth: 180 }}
            label="Example business"
            allowDeselect={false}
            value={division}
            disabled={!!draft}
            onChange={(next) => next && setDivision(next as Division)}
            data={[{ value: 'hsg', label: 'Home ServiceGenius (roofing)' }, { value: 'hospitality', label: 'Hospitality (brewery)' }]}
          />
          {editable && !draft && (
            <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setDraft(clone(saved))}>Edit example content</Button>
          )}
        </Group>
        {admin && template && !draft && (
          <Group gap="xs" mb="sm">
            {template.is_custom ? (
              <>
                <Button size="xs" variant="light" leftSection={<IconCode size={14} />} component={Link} to={`/admin/templates/${template.key}/edit`}>Edit HTML</Button>
                <Button size="xs" variant="subtle" leftSection={<IconCopy size={14} />} component={Link} to={`/admin/templates/new?from=${template.key}`}>Copy as new template</Button>
                <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => setRemoving(true)}>Remove</Button>
              </>
            ) : (
              <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} component={Link} to={`/admin/templates/new?from=${template.key}`}>Copy as new template</Button>
            )}
          </Group>
        )}
        {template && (
          <ConfirmDelete
            opened={removing}
            title="Remove this template?"
            message={`"${template.name}" will no longer be offered to any plan. Newsletters already made with it are kept. Sub-accounts using it must switch to another design first.`}
            confirmLabel="Remove template"
            success="Template removed"
            onClose={() => setRemoving(false)}
            onConfirm={() => api.removeCustomTemplate(template.key)}
            onDone={() => { setRemoving(false); setSelected(null); void client.invalidateQueries({ queryKey: ['templates'] }); void client.invalidateQueries({ queryKey: ['plans'] }); }}
          />
        )}
        <Group mb="xs" gap="xs">
          <Badge variant="light" color="gray">Example content · fictional business · never sent</Badge>
          {customised && !draft && <Badge variant="light" color="blue">Edited</Badge>}
          {draft && <Badge variant="light" color="yellow">Editing: unsaved changes show in the preview</Badge>}
        </Group>

        {draft ? (
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <Stack gap="sm">
              <Title order={5}>Newsletter</Title>
              <TextInput label="Subject line" placeholder="e.g. What to check on your roof after a storm" value={draft.subject} onChange={(e) => update((n) => { n.subject = e.currentTarget.value; })} />
              <TextInput label="Preview text" description="The line shown after the subject in the inbox" placeholder="e.g. A ten-minute walk-around that can save you a costly repair" value={draft.preview_text} onChange={(e) => update((n) => { n.preview_text = e.currentTarget.value; })} />

              <Divider my={4} />
              <Title order={5}>Example business</Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput label="Newsletter title" placeholder="e.g. The Ridgeline Home Protection Report" value={draft.brand.newsletter_name ?? ''} onChange={(e) => setBrand('newsletter_name', e.currentTarget.value)} />
                <TextInput label="Business name" placeholder="e.g. Ridgeline Roofing LLC" value={draft.brand.legal_business_name ?? ''} onChange={(e) => setBrand('legal_business_name', e.currentTarget.value)} />
                <ColorInput label="Main colour" placeholder="#14344F" value={draft.brand.primary_color ?? ''} onChange={(v) => setBrand('primary_color', v)} />
                <ColorInput label="Accent colour" placeholder="#D9822B" value={draft.brand.secondary_color ?? ''} onChange={(v) => setBrand('secondary_color', v)} />
                <TextInput label="Phone" placeholder="(555) 014-2290" value={draft.brand.phone ?? ''} onChange={(e) => setBrand('phone', e.currentTarget.value)} />
                <ImageInput folder="examples" label="Logo" placeholder="https://example.com/logo.png" value={draft.brand.logo_url ?? ''} onChange={(url) => setBrand('logo_url', url)} />
              </SimpleGrid>
              <TextInput label="Postal address" placeholder="2150 Market Street, Denver, CO 80205" value={draft.brand.postal_address ?? ''} onChange={(e) => setBrand('postal_address', e.currentTarget.value)} />
              <Textarea label="Local note" description="A short personal message from the business" placeholder="e.g. Our crews are booking fall roof assessments now…" autosize minRows={2} value={draft.brand.local_note ?? ''} onChange={(e) => setBrand('local_note', e.currentTarget.value)} />

              <Divider my={4} />
              <Title order={5}>Main story</Title>
              <TextInput label="Headline" required placeholder="e.g. What to check on your roof after a storm" value={draft.hero.headline} error={draft.hero.headline.trim() ? undefined : 'The main story needs a headline'} onChange={(e) => setHero('headline', e.currentTarget.value)} />
              <Textarea label="Teaser" placeholder="One or two sentences that make people want to read on" autosize minRows={2} value={draft.hero.teaser} onChange={(e) => setHero('teaser', e.currentTarget.value)} />
              <Textarea label="Body" description="Separate paragraphs with a blank line" placeholder="The full story" autosize minRows={4} maxRows={14} value={draft.hero.body ?? ''} onChange={(e) => setHero('body', e.currentTarget.value)} />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput label="Button label" placeholder="e.g. Schedule a roof assessment" value={draft.hero.cta_label ?? ''} onChange={(e) => setHero('cta_label', e.currentTarget.value)} />
                <ImageInput folder="examples" label="Picture" placeholder="https://example.com/roof.jpg" value={draft.hero.image_url ?? ''} onChange={(url) => setHero('image_url', url)} />
              </SimpleGrid>
              <TextInput label="Image alt text" description="Describes the image for screen readers" placeholder="e.g. Roofer checking shingles after a storm" value={draft.hero.image_alt ?? ''} onChange={(e) => setHero('image_alt', e.currentTarget.value)} />

              <Divider my={4} />
              <Group justify="space-between">
                <Title order={5}>More stories</Title>
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} disabled={draft.secondary.length >= MAX_EXTRA_STORIES}
                  onClick={() => update((n) => { n.secondary.push({ headline: '', teaser: '' }); })}>Add story</Button>
              </Group>
              {draft.secondary.length === 0 && <Text size="sm" c="dimmed">No extra stories. The preview shows the main story only.</Text>}
              {draft.secondary.map((story, index) => (
                <Paper key={index} withBorder p="sm">
                  <Group justify="space-between" mb={6}>
                    <Text size="sm" fw={600}>Story {index + 2}</Text>
                    <Tooltip label="Remove this story">
                      <ActionIcon variant="subtle" color="red" aria-label={`Remove story ${index + 2}`} onClick={() => update((n) => { n.secondary.splice(index, 1); })}><IconTrash size={16} /></ActionIcon>
                    </Tooltip>
                  </Group>
                  <Stack gap="xs">
                    <TextInput label="Headline" placeholder="e.g. Why clean gutters protect more than your roof" value={story.headline} onChange={(e) => setExtra(index, 'headline', e.currentTarget.value)} />
                    <Textarea label="Teaser" placeholder="Two or three sentences" autosize minRows={2} value={story.teaser} onChange={(e) => setExtra(index, 'teaser', e.currentTarget.value)} />
                    <TextInput label="Button label" description="Leave empty for no button" placeholder="e.g. Read the gutter checklist" value={story.cta_label ?? ''} onChange={(e) => setExtra(index, 'cta_label', e.currentTarget.value)} />
                  </Stack>
                </Paper>
              ))}

              <Divider my={4} />
              <Title order={5}>Special offer</Title>
              <TextInput label="Offer headline" placeholder="e.g. Book your pre-winter roof check" value={draft.offer.headline} onChange={(e) => setOffer('headline', e.currentTarget.value)} />
              <Textarea label="Offer text" placeholder="What the reader gets" autosize minRows={2} value={draft.offer.body} onChange={(e) => setOffer('body', e.currentTarget.value)} />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput label="Button label" placeholder="e.g. Pick a time" value={draft.offer.cta_label} onChange={(e) => setOffer('cta_label', e.currentTarget.value)} />
                <TextInput label="Link" placeholder="https://example.com/book" value={draft.offer.url} onChange={(e) => setOffer('url', e.currentTarget.value)} />
              </SimpleGrid>

              <Group justify="space-between" mt="sm">
                <Button variant="subtle" color="gray" disabled={saving}
                  onClick={() => setDraft(clone(SAMPLE_ISSUES[division]))}>Start from the original</Button>
                <Group gap="xs">
                  <Button variant="default" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
                  <Button loading={saving} disabled={!draft.hero.headline.trim()}
                    onClick={() => void persist(draft.secondary.every((s) => s.headline.trim()) ? draft : { ...draft, secondary: draft.secondary.filter((s) => s.headline.trim()) }, 'Example content saved')}>Save example</Button>
                </Group>
              </Group>
            </Stack>
            <div style={{ position: 'sticky', top: 76, alignSelf: 'start' }}>
              <EmailPreview html={rendered?.html} />
            </div>
          </SimpleGrid>
        ) : (
          <>
            <EmailPreview html={rendered?.html} />
            {editable && customised && (
              <Group justify="flex-end" mt="sm">
                <Button variant="subtle" color="gray" size="xs" loading={saving} onClick={() => void persist(null, 'Example content reset to the original')}>Reset to the original example</Button>
              </Group>
            )}
          </>
        )}
      </Paper>
    </Stack>
  );
}
