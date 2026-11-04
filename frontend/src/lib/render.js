// Single source of truth for newsletter rendering. Pure JS with no imports, so scripts/build.mjs
// can inline it into the n8n Code node and copy it into the frontend for previews.
//
// Template syntax: [[key]] is HTML-escaped, [[#key]]...[[/key]] repeats for arrays and shows for
// truthy values, and keys ending in _html are inserted as already-safe markup built here.
// GHL's own {{...}} merge tags are left untouched for GHL to resolve at send time.

const UNSUBSCRIBE_TAG = '{{email.unsubscribe_link}}';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const url = String(value ?? '').trim();
  return /^(https:\/\/|http:\/\/|mailto:|tel:)/i.test(url) ? url : '';
}

function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value ?? '')) ? value : fallback;
}

function bodyToHtml(body) {
  return String(body ?? '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 14px 0;">${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function fillTemplate(template, data) {
  // One pass only: text coming from content is never scanned again, so it cannot expand slots.
  return template.replace(/\[\[#([\w.]+)\]\]([\s\S]*?)\[\[\/\1\]\]|\[\[([\w.]+)\]\]/g, (_, section, inner, key) => {
    if (section) {
      const value = data[section];
      if (Array.isArray(value)) return value.map((item) => fillTemplate(inner, { ...data, ...item })).join('');
      return value ? fillTemplate(inner, data) : '';
    }
    const value = data[key];
    return key.endsWith('_html') ? String(value ?? '') : escapeHtml(value);
  });
}

function storyData(story, ctaUrl) {
  return {
    headline: story.headline,
    teaser: story.teaser,
    body_html: bodyToHtml(story.body),
    image_url: safeUrl(story.image_url),
    image_alt: story.image_alt || story.headline,
    cta_label: story.cta_label || '',
    cta_url: story.cta_label ? ctaUrl : '',
  };
}

function toText(data, hero, secondary) {
  const lines = [data.newsletter_name, data.edition_subject, '', hero.headline, '', hero.body || hero.teaser || ''];
  for (const story of secondary) lines.push('', story.headline, story.teaser || story.body || '');
  if (data.local_note) lines.push('', data.local_heading, data.local_note);
  if (data.offer_headline) lines.push('', data.offer_headline, data.offer_body || '', data.offer_url || '');
  lines.push('', data.legal_business_name, data.postal_address, data.phone, data.website, '', `Unsubscribe: ${UNSUBSCRIBE_TAG}`);
  return lines.filter((line) => line !== undefined && line !== null).join('\n');
}

// bundle: { template_html, labels, division, edition, tenant, brand, hero, secondary, offer }
export function renderNewsletter(bundle) {
  const { brand = {}, edition = {}, tenant = {}, hero, secondary = [], offer } = bundle;
  const errors = [];
  if (!hero) errors.push('missing_hero_story');
  for (const [field, label] of [
    ['legal_business_name', 'missing_legal_business_name'],
    ['postal_address', 'missing_postal_address'],
    ['newsletter_name', 'missing_newsletter_name'],
  ]) {
    if (!String(brand[field] ?? '').trim()) errors.push(label);
  }
  const ctaUrl = safeUrl(brand.booking_url) || safeUrl(brand.website);
  if (brand.booking_url && !safeUrl(brand.booking_url)) errors.push('invalid_booking_url');
  if (brand.website && !safeUrl(brand.website)) errors.push('invalid_website_url');
  if (brand.logo_url && !safeUrl(brand.logo_url)) errors.push('invalid_logo_url');
  if (offer?.url && !safeUrl(offer.url)) errors.push('invalid_offer_url');
  if (errors.length) return { html: null, text: null, subject: null, errors };

  const labels = (bundle.labels && bundle.labels[bundle.division || tenant.division]) || {};
  const heroData = storyData(hero, ctaUrl);
  const social = Object.entries(brand.social_links || {})
    .map(([name, url]) => ({ social_name: name, social_url: safeUrl(url) }))
    .filter((link) => link.social_url);

  const data = {
    ...labels,
    newsletter_name: brand.newsletter_name,
    edition_subject: edition.subject || hero.headline,
    preview_text: edition.preview_text || hero.teaser || '',
    logo_url: safeUrl(brand.logo_url),
    primary_color: safeColor(brand.primary_color, '#1f3a5f'),
    secondary_color: safeColor(brand.secondary_color, '#c8553d'),
    legal_business_name: brand.legal_business_name,
    postal_address: brand.postal_address,
    phone: brand.phone,
    phone_url: brand.phone ? `tel:${String(brand.phone).replace(/[^\d+]/g, '')}` : '',
    website: safeUrl(brand.website),
    social,
    local_note: brand.local_note,
    hero_headline: heroData.headline,
    hero_teaser: heroData.teaser,
    hero_body_html: heroData.body_html,
    hero_image_url: heroData.image_url,
    hero_image_alt: heroData.image_alt,
    hero_cta_label: heroData.cta_label,
    hero_cta_url: heroData.cta_url,
    secondary: secondary.map((story) => storyData(story, ctaUrl)),
    offer_headline: offer?.headline,
    offer_body: offer?.body,
    offer_cta_label: offer?.cta_label,
    offer_url: safeUrl(offer?.url) || ctaUrl,
    unsubscribe_html: `<a data-slot="unsubscribe" href="${UNSUBSCRIBE_TAG}" style="color:inherit;">Unsubscribe</a>`,
  };

  const html = fillTemplate(bundle.template_html, data);
  if (/\[\[[#/\w.]+\]\]/.test(html)) errors.push('unresolved_template_slot');
  if (!html.includes('data-slot="unsubscribe"')) errors.push('missing_unsubscribe');
  if (!html.includes('data-slot="legal"')) errors.push('missing_legal_footer');
  if (errors.length) return { html: null, text: null, subject: null, errors };

  return { html, text: toText(data, hero, secondary), subject: data.edition_subject, errors: [] };
}
