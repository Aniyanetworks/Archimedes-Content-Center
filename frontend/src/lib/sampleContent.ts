// Realistic example issues for previews. Businesses are fictional, so no real company's contact
// details are invented. Content follows the editorial rules: practical advice first, no statistics,
// guarantees, weather claims or promotional terms that would need verifying.
import type { Division, Settings } from '../api/types';

export interface SampleStory {
  headline: string;
  teaser: string;
  body?: string;
  cta_label?: string;
  image_url?: string;
  image_alt?: string;
}

type Story = SampleStory;

export interface SampleIssue {
  brand: Record<string, string | null>;
  subject: string;
  preview_text: string;
  hero: Story;
  secondary: Story[];
  offer: { headline: string; body: string; cta_label: string; url: string };
}

export const SAMPLE_ISSUES: Record<Division, SampleIssue> = {
  hsg: {
    brand: {
      newsletter_name: 'The Ridgeline Home Protection Report',
      primary_color: '#14344f',
      secondary_color: '#d9822b',
      legal_business_name: 'Ridgeline Roofing & Exteriors LLC',
      postal_address: '2150 Market Street, Suite 200, Denver, CO 80205',
      phone: '(555) 014-2290',
      website: 'https://example.com',
      booking_url: 'https://example.com/book',
      local_note: 'Our crews are booking fall roof assessments across the service area now. Most homeowners like to have any repairs finished before the first hard freeze, so earlier slots fill first.',
    },
    subject: 'What to check on your roof after a storm',
    preview_text: 'A ten-minute walk-around that can save you a costly repair later.',
    hero: {
      headline: 'What to check on your roof after a storm',
      teaser: 'A ten-minute walk-around from the ground can catch small problems before they become leaks.',
      body: 'After strong wind or hail, start with a slow walk around the house. Look for shingles that are missing, curled or lifted at the edges, and for dents in gutters, vents and flashing. Granules collecting at the bottom of downspouts can mean shingles have lost their protective surface.\n\nInside, check ceilings and the attic for new water stains or a damp smell. Take photos of anything you find, with the date, because they help with insurance claims. Please do not climb onto a wet or damaged roof. If something looks wrong, a professional assessment is the safe next step.',
      cta_label: 'Schedule a roof assessment',
    },
    secondary: [
      {
        headline: 'Why clean gutters protect more than your roof',
        teaser: 'Blocked gutters push water under shingles and against your foundation. Clearing them twice a year, in late spring and after the leaves fall, keeps water moving away from the house.',
        cta_label: 'Read the gutter checklist',
      },
      {
        headline: 'Attic ventilation: the hidden factor in shingle life',
        teaser: 'Trapped heat and moisture in the attic age shingles from underneath. Signs to watch for include frost on nails in winter and rooms upstairs that stay hot long after sunset.',
      },
    ],
    offer: {
      headline: 'Book your pre-winter roof check',
      body: 'Every assessment comes with a written report and photos of anything that needs attention, so you can decide what to fix and when.',
      cta_label: 'Pick a time',
      url: 'https://example.com/book',
    },
  },
  hospitality: {
    brand: {
      newsletter_name: 'The Granite Peak Taproom',
      primary_color: '#3d2a1a',
      secondary_color: '#b7791f',
      legal_business_name: 'Granite Peak Brewing Company LLC',
      postal_address: '418 Mill Street, Fort Collins, CO 80524',
      phone: '(555) 017-4471',
      website: 'https://example.com',
      booking_url: 'https://example.com/events',
      local_note: 'Thank you to everyone who came out for the neighborhood cleanup last weekend. The next one is on the community board by the bar, and the first round is on us for volunteers.',
    },
    subject: 'New on tap: our autumn release lineup',
    preview_text: 'Three new pours, trivia night returns and a members-only tasting.',
    hero: {
      headline: 'New on tap: our autumn release lineup',
      teaser: 'Three new beers join the taps this month, from a toasty brown ale to a crisp fresh-hop lager.',
      body: 'Our brewers have been working on this lineup since late summer. The brown ale leans on toasted malt and a little cocoa, the fresh-hop lager uses hops picked the same week we brewed it, and a small batch of pumpkin porter returns for a limited run.\n\nAsk for a tasting flight if you want to try all three side by side. Our bar team is happy to walk you through what makes each one different.',
      cta_label: 'See what is pouring',
    },
    secondary: [
      {
        headline: 'Trivia night is back on Thursdays',
        teaser: 'Teams of up to six, three rounds and a final question for the bragging rights. Food from our rotating trucks starts at 6.',
        cta_label: 'Reserve a table',
      },
      {
        headline: 'Behind the bar: meet our new head brewer',
        teaser: 'She started on our canning line and now leads the brewhouse. We asked what she is most excited to brew this winter.',
      },
    ],
    offer: {
      headline: 'Members-only tasting night',
      body: 'Mug Club members get an early pour of the winter seasonal and a chance to vote on next year’s small-batch beer.',
      cta_label: 'RSVP for members night',
      url: 'https://example.com/events',
    },
  },
};

export const sampleSettingKey = (division: Division) => `template_sample_${division}`;

// The example content admins saved on the Templates page, or the built-in one.
export function sampleIssue(division: Division, settings?: Settings | null): SampleIssue {
  const saved = settings?.[sampleSettingKey(division)] as SampleIssue | null | undefined;
  const fallback = SAMPLE_ISSUES[division];
  if (!saved || typeof saved !== 'object' || !saved.hero?.headline) return fallback;
  return {
    ...fallback,
    ...saved,
    brand: { ...fallback.brand, ...(saved.brand ?? {}) },
    secondary: Array.isArray(saved.secondary) ? saved.secondary : fallback.secondary,
    offer: { ...fallback.offer, ...(saved.offer ?? {}) },
  };
}
