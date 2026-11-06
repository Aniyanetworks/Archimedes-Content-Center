// The five master designs (spec section 6) as MJML. Every design exposes the same reusable slots:
// masthead/logo, publication title, hero story, secondary stories, local note, promo/CTA,
// contact/footer, unsubscribe and legal sender information.

const raw = (text) => `<mj-raw>${text}</mj-raw>`;

function head({ font, textColor = '#26303a', pageColor = '#eef1f4' }) {
  return `<mj-head>
    <mj-preview>[[preview_text]]</mj-preview>
    <mj-title>[[edition_subject]]</mj-title>
    <mj-attributes>
      <mj-all font-family="${font}" />
      <mj-text font-size="16px" line-height="1.55" color="${textColor}" />
      <mj-section background-color="#ffffff" padding="16px 12px" />
      <mj-button font-weight="700" border-radius="4px" font-size="15px" inner-padding="12px 22px" />
    </mj-attributes>
    <mj-raw><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></mj-raw>
    <mj-style>
      @media (prefers-color-scheme: dark) {
        .page-bg, .page-bg > table { background-color: #14181d !important; }
        .card, .card > table, .card td { background-color: #1f252c !important; }
        /* Only the default ink turns light, so brand-coloured labels keep their colour. */
        .card div[style*="color:#26303a"], .card div[style*="color:#2a2522"] { color: #e8ecf0 !important; }
      }
    </mj-style>
    <mj-raw><!-- page color ${pageColor} --></mj-raw>
  </mj-head>`;
}

function logoImage(align = 'left', width = '180px') {
  return `${raw('[[#logo_url]]')}<mj-image src="[[logo_url]]" alt="[[newsletter_name]] logo" align="${align}" width="${width}" padding="0 12px 10px" />${raw('[[/logo_url]]')}`;
}

function heroImage(padding = '0') {
  return `${raw('[[#hero_image_url]]')}<mj-section padding="${padding}" css-class="card"><mj-column><mj-image src="[[hero_image_url]]" alt="[[hero_image_alt]]" padding="0" fluid-on-mobile="true" /></mj-column></mj-section>${raw('[[/hero_image_url]]')}`;
}

function heroCta(color = '[[secondary_color]]') {
  return `${raw('[[#hero_cta_label]]')}<mj-button href="[[hero_cta_url]]" background-color="${color}" color="#ffffff" align="left">[[hero_cta_label]]</mj-button>${raw('[[/hero_cta_label]]')}`;
}

function storyCta(color = '[[primary_color]]') {
  return `${raw('[[#cta_label]]')}<mj-text padding-top="0"><a href="[[cta_url]]" style="color:${color};font-weight:700;">[[cta_label]] &rarr;</a></mj-text>${raw('[[/cta_label]]')}`;
}

function localNote(style = 'background-color="#f4f6f8"') {
  return `${raw('[[#local_note]]')}<mj-section ${style} css-class="card"><mj-column><mj-text font-size="13px" font-weight="700" color="[[primary_color]]" padding-bottom="2px">[[local_heading]]</mj-text><mj-text padding-top="0">[[local_note]]</mj-text></mj-column></mj-section>${raw('[[/local_note]]')}`;
}

function offerBand(background = '[[primary_color]]') {
  return `${raw('[[#offer_headline]]')}<mj-section background-color="${background}" padding="22px 12px"><mj-column>
    <mj-text font-size="13px" font-weight="700" color="#ffffff" padding-bottom="2px">[[offer_heading]]</mj-text>
    <mj-text font-size="21px" font-weight="700" line-height="1.25" color="#ffffff" padding-top="0" padding-bottom="4px">[[offer_headline]]</mj-text>
    <mj-text color="#ffffff" padding-top="0">[[offer_body]]</mj-text>
    ${raw('[[#offer_cta_label]]')}<mj-button href="[[offer_url]]" background-color="#ffffff" color="${background}" align="left">[[offer_cta_label]]</mj-button>${raw('[[/offer_cta_label]]')}
  </mj-column></mj-section>${raw('[[/offer_headline]]')}`;
}

function footer({ background = '#26303a', color = '#d7dde3' } = {}) {
  return `<mj-section background-color="${background}" padding="22px 12px"><mj-column>
    <mj-text font-size="13px" color="${color}" line-height="1.6">
      <span data-slot="legal"><strong>[[legal_business_name]]</strong><br>[[postal_address]]</span><br>
      [[#phone]]<a href="[[phone_url]]" style="color:${color};">[[phone]]</a><br>[[/phone]]
      [[#website]]<a href="[[website]]" style="color:${color};">[[website]]</a><br>[[/website]]
      [[#social]]<a href="[[social_url]]" style="color:${color};text-transform:capitalize;">[[social_name]]</a>&nbsp;&nbsp;[[/social]]
    </mj-text>
    <mj-text font-size="12px" color="${color}" padding-top="0">[[footer_reason]] [[unsubscribe_html]]</mj-text>
  </mj-column></mj-section>`;
}

function page(options, body) {
  return `<mjml>${head(options)}<mj-body background-color="${options.pageColor || '#eef1f4'}" width="620px" css-class="page-bg">${body}</mj-body></mjml>`;
}

const SANS = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

function protectionReport() {
  return page({ font: SANS }, `
    <mj-section background-color="[[primary_color]]" padding="24px 12px"><mj-column>
      ${logoImage()}
      <mj-text font-size="27px" font-weight="700" line-height="1.2" color="#ffffff" padding-bottom="2px">[[newsletter_name]]</mj-text>
      <mj-text font-size="14px" color="#ffffff" padding-top="0">[[edition_subject]]</mj-text>
    </mj-column></mj-section>
    ${heroImage()}
    <mj-section css-class="card"><mj-column>
      <mj-text font-size="12px" font-weight="700" letter-spacing="1px" color="[[secondary_color]]" padding-bottom="2px">[[hero_kicker]]</mj-text>
      <mj-text font-size="25px" font-weight="700" line-height="1.25" padding-top="0" padding-bottom="6px">[[hero_headline]]</mj-text>
      <mj-text padding-top="0">[[hero_body_html]]</mj-text>
      ${heroCta()}
    </mj-column></mj-section>
    <mj-section padding="4px 12px 0" css-class="card"><mj-column><mj-divider border-width="2px" border-color="[[primary_color]]" padding="0 12px" /><mj-text font-size="18px" font-weight="700" color="[[primary_color]]">[[secondary_heading]]</mj-text></mj-column></mj-section>
    ${raw('[[#secondary]]')}<mj-section padding="0 12px 8px" css-class="card"><mj-column>
      <mj-text font-size="18px" font-weight="700" line-height="1.3" padding-bottom="4px">[[headline]]</mj-text>
      <mj-text padding-top="0">[[teaser]]</mj-text>
      ${storyCta()}
    </mj-column></mj-section>${raw('[[/secondary]]')}
    ${localNote()}
    ${offerBand()}
    ${footer()}`);
}

function tipsInsights() {
  return page({ font: SANS, pageColor: '#f6f4ef' }, `
    <mj-section padding="22px 12px 14px" css-class="card" border-bottom="4px solid [[secondary_color]]"><mj-column>
      ${logoImage('left', '150px')}
      <mj-text font-size="24px" font-weight="700" color="[[primary_color]]" padding-bottom="0">[[newsletter_name]]</mj-text>
    </mj-column></mj-section>
    ${heroImage()}
    <mj-section css-class="card"><mj-column>
      <mj-text font-size="12px" font-weight="700" letter-spacing="1px" color="[[secondary_color]]" padding-bottom="2px">[[hero_kicker]]</mj-text>
      <mj-text font-size="23px" font-weight="700" line-height="1.25" padding-top="0" padding-bottom="6px">[[hero_headline]]</mj-text>
      <mj-text padding-top="0">[[hero_body_html]]</mj-text>
      ${heroCta('[[primary_color]]')}
    </mj-column></mj-section>
    <mj-section padding="10px 12px 0" background-color="#f6f4ef"><mj-column><mj-text font-size="18px" font-weight="700" color="[[primary_color]]">[[secondary_heading]]</mj-text></mj-column></mj-section>
    ${raw('[[#secondary]]')}<mj-section padding="8px 12px" css-class="card" border-left="4px solid [[secondary_color]]"><mj-column>
      <mj-text font-size="17px" font-weight="700" padding-bottom="4px">[[headline]]</mj-text>
      <mj-text padding-top="0">[[teaser]]</mj-text>
      ${storyCta()}
    </mj-column></mj-section><mj-section padding="4px" background-color="#f6f4ef"><mj-column><mj-spacer height="4px" /></mj-column></mj-section>${raw('[[/secondary]]')}
    ${localNote('background-color="#ffffff"')}
    ${offerBand('[[secondary_color]]')}
    ${footer()}`);
}

function seasonalGuide() {
  return page({ font: SANS, pageColor: '#e9efe9' }, `
    <mj-section background-color="[[secondary_color]]" padding="20px 12px"><mj-column>
      ${logoImage('center', '160px')}
      <mj-text align="center" font-size="26px" font-weight="700" color="#ffffff" padding-bottom="0">[[newsletter_name]]</mj-text>
      <mj-text align="center" font-size="14px" color="#ffffff" padding-top="2px">[[hero_kicker]]</mj-text>
    </mj-column></mj-section>
    ${heroImage()}
    <mj-section css-class="card"><mj-column>
      <mj-text font-size="25px" font-weight="700" line-height="1.25" padding-bottom="6px">[[hero_headline]]</mj-text>
      <mj-text padding-top="0">[[hero_body_html]]</mj-text>
      ${heroCta('[[primary_color]]')}
    </mj-column></mj-section>
    <mj-section padding="6px 12px 0" css-class="card"><mj-column><mj-text font-size="18px" font-weight="700" color="[[secondary_color]]">[[secondary_heading]]</mj-text></mj-column></mj-section>
    ${raw('[[#secondary]]')}<mj-section padding="4px 12px 10px" css-class="card">
      ${raw('[[#image_url]]')}<mj-column width="35%"><mj-image src="[[image_url]]" alt="[[image_alt]]" padding="6px 12px" /></mj-column>${raw('[[/image_url]]')}
      <mj-column>
        <mj-text font-size="17px" font-weight="700" padding-bottom="4px">[[headline]]</mj-text>
        <mj-text padding-top="0">[[teaser]]</mj-text>
        ${storyCta('[[secondary_color]]')}
      </mj-column>
    </mj-section>${raw('[[/secondary]]')}
    ${localNote()}
    ${offerBand()}
    ${footer()}`);
}

function improvementSavings() {
  return page({ font: SANS, pageColor: '#edf0f7' }, `
    <mj-section padding="18px 12px" css-class="card">
      <mj-column width="55%">${logoImage('left', '150px')}<mj-text font-size="21px" font-weight="700" color="[[primary_color]]" padding-bottom="0">[[newsletter_name]]</mj-text></mj-column>
      <mj-column width="45%"><mj-text align="right" font-size="13px" color="[[secondary_color]]" font-weight="700">[[hero_kicker]]</mj-text></mj-column>
    </mj-section>
    ${heroImage()}
    <mj-section css-class="card"><mj-column>
      <mj-text font-size="24px" font-weight="700" line-height="1.25" padding-bottom="6px">[[hero_headline]]</mj-text>
      <mj-text padding-top="0">[[hero_body_html]]</mj-text>
      ${heroCta()}
    </mj-column></mj-section>
    ${offerBand('[[secondary_color]]')}
    <mj-section padding="10px 12px 0" css-class="card"><mj-column><mj-text font-size="18px" font-weight="700" color="[[primary_color]]">[[secondary_heading]]</mj-text></mj-column></mj-section>
    ${raw('[[#secondary]]')}<mj-section padding="0 12px 10px" css-class="card"><mj-column>
      <mj-text font-size="17px" font-weight="700" padding-bottom="4px">[[headline]]</mj-text>
      <mj-text padding-top="0">[[teaser]]</mj-text>
      ${storyCta()}
      <mj-divider border-width="1px" border-color="#dfe4ea" padding="4px 12px 0" />
    </mj-column></mj-section>${raw('[[/secondary]]')}
    ${localNote()}
    ${footer()}`);
}

function premiumMagazine() {
  return page({ font: SERIF, textColor: '#2a2522', pageColor: '#f3efe8' }, `
    <mj-section padding="30px 12px 18px" css-class="card"><mj-column>
      ${logoImage('center', '140px')}
      <mj-text align="center" font-size="32px" line-height="1.15" color="[[primary_color]]" padding-bottom="4px">[[newsletter_name]]</mj-text>
      <mj-divider border-width="1px" border-color="[[secondary_color]]" width="70px" padding="6px 0" />
      <mj-text align="center" font-size="13px" letter-spacing="2px" color="[[secondary_color]]" padding-top="4px">[[hero_kicker]]</mj-text>
    </mj-column></mj-section>
    ${heroImage()}
    <mj-section padding="22px 22px 12px" css-class="card"><mj-column>
      <mj-text font-size="30px" line-height="1.2" padding-bottom="8px">[[hero_headline]]</mj-text>
      <mj-text font-size="17px" padding-top="0" line-height="1.65">[[hero_body_html]]</mj-text>
      ${heroCta('[[primary_color]]')}
    </mj-column></mj-section>
    <mj-section padding="10px 22px 0" css-class="card"><mj-column><mj-divider border-width="1px" border-color="#d9d2c6" padding="0 12px" /><mj-text align="center" font-size="13px" letter-spacing="2px" color="[[secondary_color]]">[[secondary_heading]]</mj-text></mj-column></mj-section>
    ${raw('[[#secondary]]')}<mj-section padding="4px 22px 10px" css-class="card"><mj-column>
      <mj-text font-size="21px" line-height="1.3" padding-bottom="4px">[[headline]]</mj-text>
      <mj-text padding-top="0">[[teaser]]</mj-text>
      ${storyCta()}
    </mj-column></mj-section>${raw('[[/secondary]]')}
    ${localNote('background-color="#faf7f1"')}
    ${offerBand()}
    ${footer({ background: '#2a2522', color: '#e6dfd3' })}`);
}

// hospitality labels keep the layouts but change the editorial language (spec section 6).
function labels(hsgKicker, hospitalityKicker) {
  return {
    hsg: {
      hero_kicker: hsgKicker,
      secondary_heading: 'Also in this issue',
      local_heading: 'From your local team',
      offer_heading: 'Offer for our neighbors',
      footer_reason: 'You are receiving this because you are a customer or subscribed to our updates.',
    },
    hospitality: {
      hero_kicker: hospitalityKicker,
      secondary_heading: 'On tap this week',
      local_heading: 'Around the neighborhood',
      offer_heading: 'For our members and regulars',
      footer_reason: 'You are receiving this because you joined our list or visited us.',
    },
  };
}

export const DESIGNS = [
  { key: 'protection_report', name: 'Homeowner Protection Report', position: 1, mjml: protectionReport(), labels: labels('HOME PROTECTION', 'THE TAPROOM REPORT') },
  { key: 'tips_insights', name: 'Tips & Insights', position: 2, mjml: tipsInsights(), labels: labels('THIS WEEK\'S TIP', 'BREWER\'S NOTES') },
  { key: 'seasonal_guide', name: 'Seasonal Guide', position: 3, mjml: seasonalGuide(), labels: labels('YOUR SEASONAL GUIDE', 'THE SEASON AT THE BREWERY') },
  { key: 'improvement_savings', name: 'Improvement & Savings', position: 4, mjml: improvementSavings(), labels: labels('IMPROVE & SAVE', 'EVENTS & MEMBER VALUE') },
  { key: 'premium_magazine', name: 'Premium Magazine', position: 5, mjml: premiumMagazine(), labels: labels('THE HOME EDITION', 'THE CRAFT EDITION') },
];
