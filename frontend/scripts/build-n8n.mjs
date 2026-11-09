// Generates ../n8n/*.json. A build-time tool only: nothing here runs in production.
// n8n stays deliberately thin: each workflow calls database RPCs
// that hold the rules, renders HTML, and talks to GHL.
//
// Set values through the environment or edit the Config node after import:
//   SUPABASE_URL  ERROR_WORKFLOW_ID  N8N_SUPABASE_CREDENTIAL_ID  N8N_SMTP_CREDENTIAL_ID  GHL_BASE  N8N_OUT_DIR
// The notification sender is not built in: workflows read it from Supabase (notification_sender),
// including whether to send by SMTP or through GoHighLevel (the notify-ghl Edge Function).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.N8N_OUT_DIR ?? path.join(here, '..', '..', 'n8n');
const render = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'render.js'), 'utf8').replace(/^export /gm, '');

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://YOUR-PROJECT.supabase.co';
const ERROR_WORKFLOW_ID = process.env.ERROR_WORKFLOW_ID ?? '';

const GHL_BASE = process.env.GHL_BASE ?? 'https://services.leadconnectorhq.com';
const GHL_VERSION = 'v3';
const SUPABASE_CRED = { supabaseApi: { id: process.env.N8N_SUPABASE_CREDENTIAL_ID ?? 'nhNQM44yDbiWIFG5', name: process.env.N8N_SUPABASE_CREDENTIAL_NAME ?? 'Archemedies' } };
const SMTP_CRED = { smtp: { id: process.env.N8N_SMTP_CREDENTIAL_ID ?? 'archimedes-smtp', name: process.env.N8N_SMTP_CREDENTIAL_NAME ?? 'Archimedes SMTP' } };

class Flow {
  constructor(name, { sensitive = false } = {}) {
    this.name = `Archimedes ${name}`;
    this.sensitive = sensitive;
    this.nodes = [];
    this.connections = {};
  }

  add(name, type, typeVersion, parameters, x, y = 300, extra = {}) {
    this.nodes.push({ id: randomUUID(), name, type, typeVersion, position: [x, y], parameters, ...extra });
    return name;
  }

  link(from, to, output = 0) {
    this.connections[from] ??= { main: [] };
    while (this.connections[from].main.length <= output) this.connections[from].main.push([]);
    this.connections[from].main[output].push({ node: to, type: 'main', index: 0 });
  }

  chain(...names) {
    for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1]);
  }

  config(x = 220, y = 300, values = {}) {
    const all = { supabaseUrl: SUPABASE_URL, ...values };
    return this.add('Config', 'n8n-nodes-base.set', 3.4, {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: Object.entries(all).map(([key, value]) => ({
          id: randomUUID(),
          name: key,
          value,
          type: typeof value === 'number' ? 'number' : 'string',
        })),
      },
      options: {},
    }, x, y);
  }

  schedule(minutes, x = 0, y = 300) {
    return this.add(`Every ${minutes} min`, 'n8n-nodes-base.scheduleTrigger', 1.2, {
      rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] },
    }, x, y);
  }

  // Calls a Postgres function through PostgREST with the service role credential.
  rpc(name, fn, bodyExpression, x, y = 300) {
    return this.add(name, 'n8n-nodes-base.httpRequest', 4.2, {
      method: 'POST',
      url: `={{ $('Config').first().json.supabaseUrl }}/rest/v1/rpc/${fn}`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify(${bodyExpression}) }}`,
      options: { timeout: 30000 },
    }, x, y, { credentials: SUPABASE_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
  }

  // GHL calls never use retryOnFail: an unknown outcome must be reconciled, never blindly retried.
  ghl(name, method, urlExpression, bodyExpression, x, y = 300, query, version = GHL_VERSION) {
    const parameters = {
      method,
      url: urlExpression,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: "=Bearer {{ $('Get GHL Token').first().json.token }}" },
          { name: 'Version', value: version },
          { name: 'Accept', value: 'application/json' },
        ],
      },
      options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
    };
    if (bodyExpression) Object.assign(parameters, { sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${bodyExpression}) }}` });
    if (query) Object.assign(parameters, { sendQuery: true, queryParameters: { parameters: query } });
    return this.add(name, 'n8n-nodes-base.httpRequest', 4.2, parameters, x, y, { onError: 'continueRegularOutput' });
  }

  code(name, jsCode, x, y = 300) {
    return this.add(name, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode }, x, y);
  }

  condition(name, expression, x, y = 300) {
    return this.add(name, 'n8n-nodes-base.if', 2.2, {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: randomUUID(), leftValue: `={{ ${expression} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    }, x, y);
  }

  loop(x, y = 300) {
    return this.add('Loop', 'n8n-nodes-base.splitInBatches', 3, { batchSize: 1, options: {} }, x, y);
  }

  pace(x, y = 300, seconds = 1) {
    return this.add('Pace', 'n8n-nodes-base.wait', 1.1, { amount: seconds, unit: 'seconds' }, x, y, { webhookId: randomUUID() });
  }

  email(name, to, subject, html, x, y = 300) {
    return this.add(name, 'n8n-nodes-base.emailSend', 2.1, {
      fromEmail: "={{ $('Get sender').first().json.from }}",
      toEmail: to,
      subject,
      emailFormat: 'html',
      html,
      options: { appendAttribution: false },
    }, x, y, { credentials: SMTP_CRED, retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 });
  }

  // Sends one email per item through whichever method is chosen on Pause and safety:
  // the SMTP node keeps the plain name (so the app can link the SMTP credential to it), and
  // "<name> (GHL)" calls the notify-ghl Edge Function, which holds the GHL token. Returns both send nodes.
  notify(name, x, y = 300) {
    const choice = this.condition(`${name}: via GoHighLevel?`, "$('Get sender').first().json.channel === 'ghl'", x, y);
    const ghl = this.add(`${name} (GHL)`, 'n8n-nodes-base.httpRequest', 4.2, {
      method: 'POST',
      url: "={{ $('Config').first().json.supabaseUrl }}/functions/v1/notify-ghl",
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ to: $json.to, subject: $json.subject, html: $json.html }) }}',
      options: { timeout: 30000 },
    }, x + 220, y - 120, { credentials: SUPABASE_CRED, retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 });
    const smtp = this.email(name, '={{ $json.to }}', '={{ $json.subject }}', '={{ $json.html }}', x + 220, y + 120);
    this.link(choice, ghl, 0);
    this.link(choice, smtp, 1);
    return { choice, sends: [ghl, smtp] };
  }

  toJSON() {
    const settings = { executionOrder: 'v1', timezone: 'UTC', saveManualExecutions: true };
    if (ERROR_WORKFLOW_ID) settings.errorWorkflow = ERROR_WORKFLOW_ID;
    // These workflows hold a GHL token in memory, so execution data is not persisted.
    if (this.sensitive) Object.assign(settings, { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false });
    return { name: this.name, nodes: this.nodes, connections: this.connections, active: false, settings, pinData: {}, meta: { templateCredsSetupCompleted: false }, tags: [] };
  }
}

const CURRENT = "$('Loop').first().json";

// Turns an HTTP Request result into one of the dispatch outcomes the database understands.
// 5xx, timeouts and 409 are "unknown" because GHL may have acted: reconcile before any retry.
const classify = (success) => `const r = $input.first().json;
const status = r.statusCode;
const headers = r.headers || {};
let outcome;
if (status >= 200 && status < 300) outcome = '${success}';
else if (status === 429) outcome = 'retry_safe';
else if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) outcome = 'failed';
else outcome = 'unknown';
const body = r.body && typeof r.body === 'object' ? r.body : {};
const message = outcome === '${success}' ? null : String(body.message || r.error?.message || r.message || 'HTTP ' + status).slice(0, 500);
return [{ json: {
  outcome,
  http_status: status ?? null,
  message,
  ghl_campaign_id: body.id || body.campaignId || null,
  burst_remaining: headers['x-ratelimit-remaining'] != null ? Number(headers['x-ratelimit-remaining']) : null,
  daily_remaining: headers['x-ratelimit-daily-remaining'] != null ? Number(headers['x-ratelimit-daily-remaining']) : null,
} }];`;

const escapeFn = `const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');`;

// ---------------------------------------------------------------------------------------------
function phase0() {
  const f = new Flow('01 Phase 0 - GHL proof of concept');
  f.add('Run manually', 'n8n-nodes-base.manualTrigger', 1, {}, 0);
  f.add('Config', 'n8n-nodes-base.set', 3.4, {
    mode: 'manual',
    includeOtherFields: false,
    assignments: {
      assignments: [
        ['testLocationId', 'SET_TEST_SUBACCOUNT_LOCATION_ID'], ['testUserId', 'SET_TEST_SUBACCOUNT_USER_ID'], ['testContactId', 'SET_INTERNAL_TEST_CONTACT_ID'],
        ['fromName', 'Archimedes Test'], ['fromEmail', 'SET_VERIFIED_SENDER@YOUR-DOMAIN.example'], ['timeZone', 'America/Denver'], ['sendAt', '2030-01-01 09:00 AM'],
      ].map(([name, value]) => ({ id: randomUUID(), name, value, type: 'string' })),
    },
    options: {},
  }, 220);
  f.code('Render test email', `return [{ json: { html: '<html><body><h1>Archimedes Phase 0 test</h1><p>Internal test only.</p><p><a href="{{email.unsubscribe_link}}">Unsubscribe</a></p></body></html>', name: 'Archimedes Phase 0 test ' + Date.now() } }];`, 440);
  const auth = (extra) => ({
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Version', value: GHL_VERSION }, { name: 'Accept', value: 'application/json' }] },
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
    ...extra,
  });
  const cred = { credentials: { httpHeaderAuth: { id: 'ghl-phase0-token', name: 'GHL Phase 0 Test Token' } } };
  const base = `${GHL_BASE}/emails/locations/{{ $('Config').first().json.testLocationId }}/campaigns/emails`;
  f.add('Create draft', 'n8n-nodes-base.httpRequest', 4.2, auth({
    method: 'POST', url: `=${base}`, sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ name: $('Render test email').first().json.name, editorType: 'html', editorContent: $('Render test email').first().json.html, timeZone: $('Config').first().json.timeZone, userId: $('Config').first().json.testUserId }) }}`,
  }), 660, 300, cred);
  f.add('Schedule to test contact', 'n8n-nodes-base.httpRequest', 4.2, auth({
    method: 'POST', url: `=${base}/{{ $('Create draft').first().json.body.id }}/schedule`, sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ scheduleType: 'scheduled', timeZone: $('Config').first().json.timeZone, userId: $('Config').first().json.testUserId, emailMeta: { subject: 'Archimedes Phase 0 test', fromName: $('Config').first().json.fromName, fromEmail: $('Config').first().json.fromEmail }, recipients: { type: 'contact', contactIds: [$('Config').first().json.testContactId] }, scheduleConfig: { sendAt: $('Config').first().json.sendAt } }) }}`,
  }), 880, 300, cred);
  f.add('Read back status', 'n8n-nodes-base.httpRequest', 4.2, auth({ method: 'GET', url: `=${base}/{{ $('Create draft').first().json.body.id }}` }), 1100, 300, cred);
  f.add('Try delete (cancel test)', 'n8n-nodes-base.httpRequest', 4.2, auth({ method: 'DELETE', url: `=${base}/{{ $('Create draft').first().json.body.id }}` }), 1320, 300, cred);
  f.code('Feasibility result', `const step = (name) => { const r = $(name).first().json; return { status: r.statusCode, body: r.body }; };
return [{ json: { create: step('Create draft'), schedule: step('Schedule to test contact'), readBack: step('Read back status'), deleteScheduled: step('Try delete (cancel test)') } }];`, 1540);
  f.chain('Run manually', 'Config', 'Render test email', 'Create draft', 'Schedule to test contact', 'Read back status', 'Try delete (cancel test)', 'Feasibility result');
  return f;
}

function editionQueue() {
  const f = new Flow('02 Edition approved - queue tenant campaigns');
  f.schedule(5, 0);
  f.config();
  // The database decides what still needs queueing, so repeated runs are harmless.
  f.rpc('Editions to queue', 'list_editions_to_queue', '{}', 440);
  f.loop(660);
  f.rpc('Queue campaigns', 'queue_edition_campaigns', `{ p_edition: ${CURRENT}.edition_id }`, 880);
  f.chain('Every 5 min', 'Config', 'Editions to queue', 'Loop');
  f.link('Loop', 'Queue campaigns', 1);
  f.link('Queue campaigns', 'Loop');
  return f;
}

function renderRoute() {
  const f = new Flow('03 Render and route');
  f.schedule(5, 0);
  f.config();
  f.rpc('Claim campaigns to render', 'claim_campaigns_for_render', '{ p_limit: 50 }', 440);
  f.loop(660);
  f.code('Render HTML', `${render}
const bundle = $('Loop').first().json;
const result = renderNewsletter(bundle);
return [{ json: { campaign_id: bundle.campaign_id, html: result.html, text: result.text, subject: result.subject, errors: result.errors } }];`, 880);
  f.condition('Rendered cleanly?', '$json.errors.length === 0', 1100);
  // record_render stores the hash server-side, then routes to automatic or client review (data-flow step 4).
  f.rpc('Store render and route', 'record_render', "{ p_id: $('Render HTML').first().json.campaign_id, p_html: $('Render HTML').first().json.html, p_text: $('Render HTML').first().json.text, p_subject: $('Render HTML').first().json.subject }", 1320, 200);
  f.rpc('Hold render failure', 'record_render_failure', "{ p_id: $('Render HTML').first().json.campaign_id, p_errors: $('Render HTML').first().json.errors }", 1320, 400);
  f.pace(1540, 300, 1);
  f.chain('Every 5 min', 'Config', 'Claim campaigns to render', 'Loop');
  f.link('Loop', 'Render HTML', 1);
  f.link('Render HTML', 'Rendered cleanly?');
  f.link('Rendered cleanly?', 'Store render and route', 0);
  f.link('Rendered cleanly?', 'Hold render failure', 1);
  f.link('Store render and route', 'Pace');
  f.link('Hold render failure', 'Pace');
  f.link('Pace', 'Loop');
  return f;
}

function reviewInvites() {
  const f = new Flow('04 Send review invites', { sensitive: true });
  f.schedule(5, 0);
  f.config();
  f.rpc('Invites due', 'list_review_invites_due', '{ p_limit: 50 }', 440);
  f.loop(660);
  // The Edge Function signs the token, so the signing secret never enters n8n.
  f.add('Issue signed link', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: "={{ $('Config').first().json.supabaseUrl }}/functions/v1/review-issue",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ campaign_id: ${CURRENT}.campaign_id }) }}`,
    options: { timeout: 30000 },
  }, 880, 300, { credentials: SUPABASE_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
  f.code('Build email', `${escapeFn}
const c = $('Loop').first().json;
const link = $input.first().json;
const html = '<p>Hello' + (c.reviewer_name ? ' ' + esc(c.reviewer_name) : '') + ',</p>'
  + '<p>The next issue of <strong>' + esc(c.newsletter_name) + '</strong> is ready for your review.</p>'
  + '<p>Please decide by <strong>' + esc(c.deadline_display) + '</strong>. If we do not hear from you by then, it is held and will not be sent.</p>'
  + '<p><a href="' + esc(link.url) + '">Review the newsletter</a></p>'
  + '<p>This secure link is for you only and expires at the deadline.</p>';
return [{ json: { to: link.to, subject: 'Review needed: ' + c.newsletter_name, html } }];`, 1100);
  const invite = f.notify('Send invite', 1320);
  f.rpc('Mark invite sent', 'mark_review_invite_sent', `{ p_id: ${CURRENT}.campaign_id }`, 1760);
  f.pace(1980, 300, 1);
  f.rpc('Get sender', 'notification_sender', '{}', 330, 480);
  f.chain('Every 5 min', 'Config', 'Get sender', 'Invites due', 'Loop');
  f.link('Loop', 'Issue signed link', 1);
  f.chain('Issue signed link', 'Build email', invite.choice);
  for (const send of invite.sends) f.link(send, 'Mark invite sent');
  f.chain('Mark invite sent', 'Pace', 'Loop');
  return f;
}

function reviewDeadlines() {
  const f = new Flow('05 Hold missed review deadlines');
  f.schedule(15, 0);
  f.config();
  // Missing approval means HOLD and a notification, never an automatic send.
  f.rpc('Hold expired reviews', 'hold_expired_reviews', '{}', 440);
  f.code('Build notice', `${escapeFn}
return $input.all().map(({ json: c }) => ({ json: {
  to: c.notify_email,
  subject: 'Newsletter held: ' + c.newsletter_name,
  html: '<p>The review deadline for <strong>' + esc(c.newsletter_name) + '</strong> passed without a decision, so this issue has been held and will not be sent.</p><p>Contact Archimedes support if you would still like it to go out.</p>',
} }));`, 660);
  const notice = f.notify('Notify reviewer', 880);
  f.rpc('Get sender', 'notification_sender', '{}', 330, 480);
  f.chain('Every 15 min', 'Config', 'Get sender', 'Hold expired reviews', 'Build notice', notice.choice);
  return f;
}

function dispatch() {
  const f = new Flow('06 Dispatch to GHL', { sensitive: true });
  f.schedule(5, 0);
  f.config();
  // Only campaigns inside the next hour are claimed, so holds and pauses keep working until the last moment.
  f.rpc('Claim campaigns to dispatch', 'claim_campaigns_for_dispatch', '{ p_limit: 100, p_window_minutes: 60 }', 440);
  f.loop(660);
  f.condition('Dry run?', `${CURRENT}.dry_run === true`, 880);
  f.rpc('Record dry run', 'record_dry_run', `{ p_id: ${CURRENT}.campaign_id }`, 1100, 60);
  f.rpc('Get GHL Token', 'get_ghl_token', `{ p_location: ${CURRENT}.ghl_location_id }`, 1100, 320);
  f.condition('Draft already exists?', `!!${CURRENT}.ghl_campaign_id`, 1320, 320);
  const base = `=${GHL_BASE}/emails/locations/{{ $('Loop').first().json.ghl_location_id }}/campaigns/emails`;
  f.ghl('Create GHL draft', 'POST', base, `${CURRENT}.ghl_create_body`, 1540, 480);
  f.code('Classify create', classify('created'), 1760, 480);
  f.condition('Draft created?', "$json.outcome === 'created'", 1980, 480);
  f.rpc('Store draft id', 'record_ghl_draft', `{ p_id: ${CURRENT}.campaign_id, p_ghl_id: $('Classify create').first().json.ghl_campaign_id }`, 2200, 400);
  f.rpc('Record create outcome', 'record_dispatch_result', `{ p_id: ${CURRENT}.campaign_id, p_stage: 'create', p_outcome: $('Classify create').first().json.outcome, p_http_status: $('Classify create').first().json.http_status, p_message: $('Classify create').first().json.message, p_burst: $('Classify create').first().json.burst_remaining, p_daily: $('Classify create').first().json.daily_remaining }`, 2200, 620);
  // Last gate before anything can send: revoked approvals, pauses and edits made since the claim all stop here.
  f.rpc('Pre-schedule check', 'pre_schedule_check', `{ p_id: ${CURRENT}.campaign_id }`, 2420, 240);
  f.condition('Clear to schedule?', '$json.clear === true', 2640, 240);
  f.ghl('Schedule in GHL', 'POST', `${base}/{{ $('Pre-schedule check').first().json.ghl_campaign_id }}/schedule`, `${CURRENT}.ghl_schedule_body`, 2860, 160);
  f.code('Classify schedule', classify('scheduled'), 3080, 160);
  f.rpc('Record schedule outcome', 'record_dispatch_result', `{ p_id: ${CURRENT}.campaign_id, p_stage: 'schedule', p_outcome: $('Classify schedule').first().json.outcome, p_http_status: $('Classify schedule').first().json.http_status, p_message: $('Classify schedule').first().json.message, p_burst: $('Classify schedule').first().json.burst_remaining, p_daily: $('Classify schedule').first().json.daily_remaining }`, 3300, 160);
  f.pace(3520, 300, 1);

  f.chain('Every 5 min', 'Config', 'Claim campaigns to dispatch', 'Loop');
  f.link('Loop', 'Dry run?', 1);
  f.link('Dry run?', 'Record dry run', 0);
  f.link('Dry run?', 'Get GHL Token', 1);
  f.link('Record dry run', 'Pace');
  f.link('Get GHL Token', 'Draft already exists?');
  f.link('Draft already exists?', 'Pre-schedule check', 0);
  f.link('Draft already exists?', 'Create GHL draft', 1);
  f.chain('Create GHL draft', 'Classify create', 'Draft created?');
  f.link('Draft created?', 'Store draft id', 0);
  f.link('Draft created?', 'Record create outcome', 1);
  f.link('Store draft id', 'Pre-schedule check');
  f.link('Record create outcome', 'Pace');
  f.link('Pre-schedule check', 'Clear to schedule?');
  f.link('Clear to schedule?', 'Schedule in GHL', 0);
  f.link('Clear to schedule?', 'Pace', 1);
  f.chain('Schedule in GHL', 'Classify schedule', 'Record schedule outcome', 'Pace', 'Loop');
  return f;
}

function reconcile() {
  const f = new Flow('07 Reconcile campaign state', { sensitive: true });
  f.schedule(15, 0);
  f.config();
  f.rpc('Campaigns to reconcile', 'list_campaigns_to_reconcile', '{ p_limit: 100 }', 440);
  f.loop(660);
  f.rpc('Get GHL Token', 'get_ghl_token', `{ p_location: ${CURRENT}.ghl_location_id }`, 880);
  f.condition('GHL id known?', `!!${CURRENT}.ghl_campaign_id`, 1100);
  const base = `=${GHL_BASE}/emails/locations/{{ $('Loop').first().json.ghl_location_id }}/campaigns/emails`;
  f.ghl('Get by id', 'GET', `${base}/{{ $('Loop').first().json.ghl_campaign_id }}`, null, 1320, 200);
  // Campaign names embed the idempotency key, which is how an interrupted create is found again.
  // GHL keeps cancelled campaigns in the list, so those never count as a match.
  f.ghl('Search by idempotency key', 'GET', base, null, 1320, 400, [
    { name: 'search', value: "={{ $('Loop').first().json.idempotency_key }}" },
    { name: 'limit', value: '20' },
    { name: 'status', value: 'all' },
  ]);
  f.code('Normalize', `const c = $('Loop').first().json;
const r = $input.first().json;
const status = r.statusCode;
const body = r.body && typeof r.body === 'object' ? r.body : {};
if (!(status >= 200 && status < 300)) {
  // Still unknown. Stay in reconciliation and try again later.
  return [{ json: { reachable: false, found: null, ghl_id: null, ghl_status: null, http_status: status ?? null } }];
}
const match = Array.isArray(body.campaigns)
  ? body.campaigns.find((row) => !row.deleted && row.status !== 'cancelled' && String(row.name || '').includes(c.idempotency_key))
  : body;
return [{ json: { reachable: true, found: !!match && !match.deleted, ghl_id: match?.id ?? null, ghl_status: match?.status ?? null, http_status: status } }];`, 1540);
  f.rpc('Record reconcile', 'record_reconcile', `{ p_id: ${CURRENT}.campaign_id, p_reachable: $json.reachable, p_found: $json.found, p_ghl_id: $json.ghl_id, p_ghl_status: $json.ghl_status, p_http_status: $json.http_status }`, 1760);
  f.pace(1980, 300, 1);
  f.chain('Every 15 min', 'Config', 'Campaigns to reconcile', 'Loop');
  f.link('Loop', 'Get GHL Token', 1);
  f.link('Get GHL Token', 'GHL id known?');
  f.link('GHL id known?', 'Get by id', 0);
  f.link('GHL id known?', 'Search by idempotency key', 1);
  f.link('Get by id', 'Normalize');
  f.link('Search by idempotency key', 'Normalize');
  f.chain('Normalize', 'Record reconcile', 'Pace', 'Loop');
  return f;
}

function emergencyCancel() {
  const f = new Flow('08 Emergency cancel in GHL', { sensitive: true });
  f.schedule(5, 0);
  f.config();
  f.rpc('Cancel requests', 'list_cancel_requests', '{ p_limit: 100 }', 440);
  f.loop(660);
  f.rpc('Get GHL Token', 'get_ghl_token', `{ p_location: ${CURRENT}.ghl_location_id }`, 880);
  f.ghl('Delete GHL campaign', 'DELETE', `=${GHL_BASE}/emails/locations/{{ $('Loop').first().json.ghl_location_id }}/campaigns/emails/{{ $('Loop').first().json.ghl_campaign_id }}`, null, 1100);
  f.code('Check result', `const r = $input.first().json;
// 404 means it is already gone, which is the outcome a cancel wants.
const ok = r.statusCode === 404 || (r.statusCode >= 200 && r.statusCode < 300 && r.body?.deleted !== false);
return [{ json: { ok, message: ok ? null : String(r.body?.message || r.error?.message || 'HTTP ' + r.statusCode).slice(0, 500) } }];`, 1320);
  f.rpc('Record cancel result', 'record_cancel_result', `{ p_id: ${CURRENT}.campaign_id, p_ok: $json.ok, p_message: $json.message }`, 1540);
  f.pace(1760, 300, 1);
  f.chain('Every 5 min', 'Config', 'Cancel requests', 'Loop');
  f.link('Loop', 'Get GHL Token', 1);
  f.chain('Get GHL Token', 'Delete GHL campaign', 'Check result', 'Record cancel result', 'Pace', 'Loop');
  return f;
}

function opsAlerts() {
  const f = new Flow('09 Operations alerts');
  f.schedule(15, 0);
  f.config();
  f.rpc('Claim alerts', 'claim_ops_alerts', '{ p_limit: 200 }', 440);
  f.code('Build digest', `${escapeFn}
const alerts = $input.all().map((item) => item.json);
if (!alerts.length || !alerts[0].id) return [];
const rows = alerts.map((a) => '<li><strong>' + esc(a.severity) + '</strong> ' + esc(a.kind) + ': ' + esc(a.message) + '</li>').join('');
return [{ json: { to: alerts[0].notify_email, subject: 'Archimedes engine: ' + alerts.length + ' alert(s)', html: '<ul>' + rows + '</ul>' } }];`, 660);
  const digest = f.notify('Email operations', 880);
  f.rpc('Get sender', 'notification_sender', '{}', 330, 480);
  f.chain('Every 15 min', 'Config', 'Get sender', 'Claim alerts', 'Build digest', digest.choice);
  return f;
}

// GHL marks a campaign "sent" even when every email was rejected, so delivery is checked separately.
function deliveryCheck() {
  const f = new Flow('11 Check delivery', { sensitive: true });
  f.schedule(15, 0);
  f.config();
  f.rpc('Campaigns to check', 'list_campaigns_to_check_delivery', '{ p_limit: 100 }', 440);
  f.loop(660);
  f.rpc('Get GHL Token', 'get_ghl_token', `{ p_location: ${CURRENT}.ghl_location_id }`, 880);
  // The name filter is a regular expression; idempotency keys hold only letters, digits, dashes and colons.
  f.ghl('Campaign stats', 'GET', `=${GHL_BASE}/emails/schedule`, null, 1100, 300, [
    { name: 'locationId', value: "={{ $('Loop').first().json.ghl_location_id }}" },
    { name: 'name', value: "={{ $('Loop').first().json.idempotency_key }}" },
    { name: 'showStats', value: 'true' },
    { name: 'campaignsOnly', value: 'true' },
    { name: 'limit', value: '20' },
  ], '2021-07-28');
  f.code('Normalize stats', `const c = $('Loop').first().json;
const r = $input.first().json;
if (!(r.statusCode >= 200 && r.statusCode < 300)) return [{ json: { reachable: false } }];
const row = (r.body?.schedules ?? []).find((s) => s.id === c.ghl_campaign_id);
if (!row) return [{ json: { reachable: true, found: false } }];
return [{ json: { reachable: true, found: true, total: row.totalCount ?? 0, delivered: Math.max(row.delivered ?? 0, row.successCount ?? 0), queued: row.queuedCount ?? 0 } }];`, 1320);
  f.rpc('Record delivery', 'record_delivery_check', `{ p_id: ${CURRENT}.campaign_id, p_reachable: $json.reachable, p_found: $json.found ?? null, p_total: $json.total ?? null, p_delivered: $json.delivered ?? null, p_queued: $json.queued ?? null }`, 1540);
  f.pace(1760, 300, 1);
  f.chain('Every 15 min', 'Config', 'Campaigns to check', 'Loop');
  f.link('Loop', 'Get GHL Token', 1);
  f.chain('Get GHL Token', 'Campaign stats', 'Normalize stats', 'Record delivery', 'Pace', 'Loop');
  return f;
}

function errorHandler() {
  const f = new Flow('10 Workflow error handler');
  f.add('On workflow error', 'n8n-nodes-base.errorTrigger', 1, {}, 0);
  f.config();
  // Writes to the audit log and raises an operations alert, which workflow 09 emails.
  f.rpc('Record workflow error', 'record_workflow_error', "{ p_workflow: $('On workflow error').first().json.workflow?.name ?? 'unknown', p_node: $('On workflow error').first().json.execution?.lastNodeExecuted ?? null, p_message: String($('On workflow error').first().json.execution?.error?.message ?? 'Unknown error').slice(0, 500), p_execution: String($('On workflow error').first().json.execution?.id ?? '') }", 440);
  f.chain('On workflow error', 'Config', 'Record workflow error');
  return f;
}

const flows = [
  ['01-phase0-ghl-proof.json', phase0()],
  ['02-edition-queue.json', editionQueue()],
  ['03-render-route.json', renderRoute()],
  ['04-review-invites.json', reviewInvites()],
  ['05-review-deadlines.json', reviewDeadlines()],
  ['06-dispatch.json', dispatch()],
  ['07-reconcile.json', reconcile()],
  ['08-emergency-cancel.json', emergencyCancel()],
  ['09-ops-alerts.json', opsAlerts()],
  ['10-error-handler.json', errorHandler()],
  ['11-delivery-check.json', deliveryCheck()],
];

fs.mkdirSync(outDir, { recursive: true });
for (const [file, flow] of flows) fs.writeFileSync(path.join(outDir, file), JSON.stringify(flow, null, 2) + '\n');
console.log(`Wrote ${flows.length} workflows to ${outDir}`);
