import { useState } from 'react';
import { Alert, Button, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { BrandProfile, Division, TemplateInfo } from '../api/types';
import { renderNewsletter } from '../lib/render.js';
import { sampleIssue } from '../lib/sampleContent';
import { EmailPreview } from './EmailPreview';

// Fields a newsletter cannot be built without. Empty ones are filled from the example business for the preview only.
const REQUIRED: Array<[keyof BrandProfile, string]> = [
  ['newsletter_name', 'newsletter title'],
  ['legal_business_name', 'legal business name'],
  ['postal_address', 'postal address'],
];

// A "Preview" button that shows a design with this sub-account's own branding and example stories.
export function DesignPreviewButton({ template, division, brand, businessName }: {
  template: TemplateInfo | undefined;
  division: Division;
  brand: Partial<BrandProfile>;
  businessName?: string;
}) {
  const [opened, setOpened] = useState(false);
  const [view, setView] = useState<'theirs' | 'example'>('theirs');
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, enabled: opened });
  const example = sampleIssue(division, settings.data);

  const filled = REQUIRED.filter(([key]) => !String(brand[key] ?? '').trim()).map(([, label]) => label);
  // Their own details only; just the required fields they have not filled in yet come from the example.
  const ownBrand: Record<string, unknown> = { ...brand };
  for (const [key] of REQUIRED) {
    if (!String(brand[key] ?? '').trim()) ownBrand[key] = example.brand[key];
  }
  const useOwn = view === 'theirs';
  const ownOffer = brand.offer_headline
    ? { headline: brand.offer_headline, body: brand.offer_body ?? '', cta_label: brand.offer_cta_label ?? '', url: brand.offer_url ?? '' }
    : null;

  const result = template && opened
    ? renderNewsletter({
      template_html: template.html,
      labels: template.labels,
      division,
      edition: { subject: example.subject, preview_text: example.preview_text },
      tenant: { division },
      brand: useOwn ? ownBrand : example.brand,
      hero: example.hero,
      secondary: example.secondary,
      offer: useOwn ? (ownOffer ?? example.offer) : example.offer,
    })
    : null;

  return (
    <>
      <Button variant="light" leftSection={<IconEye size={16} />} disabled={!template} onClick={() => setOpened(true)}>Preview</Button>
      <Modal opened={opened} onClose={() => setOpened(false)} size="xl" title={`${template?.name ?? 'Design'} preview`}>
        <Stack gap="sm">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as 'theirs' | 'example')}
            data={[{ value: 'theirs', label: businessName ? `${businessName}'s branding` : 'Their branding' }, { value: 'example', label: 'Example business' }]}
          />
          <Text size="xs" c="dimmed">
            Example stories are shown. The real newsletter uses this week's approved stories.
            {useOwn && !ownOffer ? ' No offer is saved yet, so the example offer is shown.' : ''}
          </Text>
          {useOwn && filled.length > 0 && (
            <Alert color="yellow" p="xs">Not filled in yet, so example values are shown for: {filled.join(', ')}.</Alert>
          )}
          {result?.html
            ? <EmailPreview html={result.html} height={620} />
            : <Alert color="orange">This design can't be previewed: {(result?.errors as string[] | undefined)?.join(', ') || 'choose a design first'}.</Alert>}
        </Stack>
      </Modal>
    </>
  );
}
