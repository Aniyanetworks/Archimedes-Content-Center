import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { renderNewsletter } from '../src/lib/render.js';

const templates = JSON.parse(fs.readFileSync(new URL('../src/generated/templates.json', import.meta.url), 'utf8'));

const brand = {
  newsletter_name: 'Roof News', legal_business_name: 'Roof LLC', postal_address: '1 Main St, Denver, CO', phone: '(555) 010-0100', website: 'https://roof.example.com',
  booking_url: 'https://roof.example.com/book', primary_color: '#112233', secondary_color: '#445566', local_note: 'Local note text',
};
const hero = { headline: 'Hero headline', teaser: 'Hero teaser', body: 'First paragraph.\n\nSecond paragraph.', cta_label: 'Book now', image_url: 'https://cdn.example.com/a.jpg', image_alt: 'A roof' };
const secondary = [{ headline: 'Second story', teaser: 'Second teaser', image_url: 'https://cdn.example.com/b.jpg' }];
const offer = { headline: 'An offer', body: 'Offer text', cta_label: 'Claim', url: 'https://roof.example.com/offer' };

function render(template, overrides = {}) {
  return renderNewsletter({ template_html: template.html, labels: template.labels, division: 'hsg', edition: { subject: 'The subject', preview_text: 'Preview' }, tenant: {}, brand, hero, secondary, offer, ...overrides });
}

describe('five master designs', () => {
  test('there are five designs', () => assert.equal(templates.length, 5));

  for (const template of templates) {
    test(`${template.name} fills every slot`, () => {
      const { html, text, errors, subject } = render(template);
      assert.deepEqual(errors, []);
      assert.equal(subject, 'The subject');
      for (const expected of ['Roof News', 'Hero headline', 'First paragraph.', 'Second story', 'Local note text', 'An offer', 'Roof LLC', '1 Main St, Denver, CO', 'data-slot="unsubscribe"', '{{email.unsubscribe_link}}', 'https://roof.example.com/book', '#112233']) {
        assert.ok(html.includes(expected), `${template.key} is missing ${expected}`);
      }
      assert.ok(!/\[\[/.test(html), 'no unresolved slots');
      assert.ok(html.includes('alt="A roof"'), 'images keep alt text');
      assert.ok(html.includes('prefers-color-scheme'), 'dark mode handled');
      assert.ok(html.includes('@media only screen'), 'responsive rules present');
      assert.ok(text.includes('Hero headline') && text.includes('Unsubscribe'), 'text fallback');
    });

    test(`${template.name} hides optional modules cleanly`, () => {
      const { html, errors } = render(template, { brand: { ...brand, local_note: null, phone: null }, offer: null, secondary: [], hero: { headline: 'H', body: 'B' } });
      assert.deepEqual(errors, []);
      assert.ok(!html.includes('Local note text'));
      assert.ok(!html.includes('An offer'));
      assert.ok(!/\[\[/.test(html));
    });

    test(`${template.name} uses hospitality labels for breweries`, () => {
      const { html } = render(template, { division: 'hospitality' });
      assert.ok(html.includes(template.labels.hospitality.secondary_heading));
      assert.ok(!html.includes(template.labels.hsg.secondary_heading));
    });
  }
});

describe('safety of rendered output', () => {
  const template = templates[0];

  test('content is escaped, so stored text cannot inject markup', () => {
    const { html } = render(template, { hero: { headline: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>' } });
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('template syntax inside content is not expanded', () => {
    const { html, errors } = render(template, { hero: { headline: 'Plain', body: 'Plain body' }, brand: { ...brand, local_note: 'See [[legal_business_name]]' } });
    assert.deepEqual(errors, ['unresolved_template_slot']);
    assert.equal(html, null, 'held rather than sent with raw syntax');
  });

  test('dangerous link schemes are refused', () => {
    assert.ok(render(template, { brand: { ...brand, booking_url: 'javascript:alert(1)' } }).errors.includes('invalid_booking_url'));
    assert.ok(render(template, { offer: { ...offer, url: 'javascript:alert(1)' } }).errors.includes('invalid_offer_url'));
  });

  test('bad colors fall back instead of reaching the CSS', () => {
    const { html } = render(template, { brand: { ...brand, primary_color: 'red;}body{display:none' } });
    assert.ok(!html.includes('display:none;}'));
    assert.ok(html.includes('#1f3a5f'));
  });

  test('mandatory sender fields block the render', () => {
    assert.ok(render(template, { brand: { ...brand, postal_address: '' } }).errors.includes('missing_postal_address'));
    assert.ok(render(template, { brand: { ...brand, legal_business_name: null } }).errors.includes('missing_legal_business_name'));
    assert.ok(render(template, { hero: null }).errors.includes('missing_hero_story'));
  });

  test('a template without an unsubscribe link fails', () => {
    const { errors } = render(template, { template_html: '<html><span data-slot="legal">x</span></html>' });
    assert.ok(errors.includes('missing_unsubscribe'));
  });

  test('two tenants get identical editorial content with their own brand', () => {
    const a = render(template);
    const b = render(template, { brand: { ...brand, newsletter_name: 'Other News', phone: '(555) 010-0999' } });
    for (const output of [a, b]) assert.ok(output.html.includes('Hero headline'));
    assert.ok(a.html.includes('Roof News') && !a.html.includes('Other News'));
    assert.ok(b.html.includes('(555) 010-0999') && !b.html.includes('(555) 010-0100'));
  });
});
