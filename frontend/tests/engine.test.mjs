// The spec's section 14 scenarios, run against the real migrations in an embedded Postgres.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { addApprovedEdition, addStory, addTenant, as, call, campaign, createDb, mondayFromNow, one, publish, rows } from './helpers.mjs';

let db;
let staff;
let tenantUserA;

async function asStaff(work) {
  return as(db, 'authenticated', staff, work);
}

const claim = async () => (await call(db, 'claim_campaigns_for_dispatch', [100, 10000000])).map((r) => r.claim_campaigns_for_dispatch);

// Claims a campaign and walks it through a successful GHL draft and pre-schedule check.
async function draftAndCheck(id, ghlId = 'ghl-1') {
  await call(db, 'record_ghl_draft', [id, ghlId]);
  return (await call(db, 'pre_schedule_check', [id]))[0].pre_schedule_check;
}

async function approveByReviewer(c) {
  const token = (await call(db, 'issue_review_token', [c.id]))[0].issue_review_token;
  const ids = [token.jti, token.cid, token.tid, token.hash];
  await db.query(`select review_decide($1, $2, $3, $4, 'approve', $4, null)`, ids);
  return token;
}

before(async () => {
  db = await createDb();
  staff = (await one(db, `insert into auth.users (email) values ('admin@example.com') returning id`)).id;
  await db.query(`insert into staff_roles values ($1, 'admin')`, [staff]);
  await db.exec(`update system_settings set value = '"production"' where key = 'environment'; update system_settings set value = 'false' where key = 'safe_test_mode'; update system_settings set value = '["internal@example.com"]' where key = 'internal_preview_addresses';`);
});

describe('entitlements', () => {
  test('Essentials has exactly two eligible designs, Growth and Freedom have five', async () => {
    const counts = await rows(db, 'select plan_key, count(*)::int as n from plan_templates group by plan_key');
    const n = Object.fromEntries(counts.map((row) => [row.plan_key, row.n]));
    assert.equal(n.hsg_essentials, 2);
    assert.equal(n.hsg_growth, 5);
    assert.equal(n.hsg_freedom, 5);
  });

  test('saving a design outside the plan is refused', async () => {
    const t = await addTenant(db, { plan: 'hsg_essentials', cadence: 'biweekly', template: 'tips_insights' });
    await asStaff(() => assert.rejects(
      db.query(`select save_tenant($1, '{}', $2)`, [{ id: t.id }, { template_key: 'premium_magazine' }]),
      /not included in this plan/,
    ));
  });

  test('a downgrade changes future entitlements and leaves sent campaigns untouched', async () => {
    const t = await addTenant(db, { template: 'premium_magazine' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(30) });
    const [c] = (await publish(db, edition)).filter((row) => row.tenant_id === t.id);
    const before = await campaign(db, c.id);
    await asStaff(() => db.query(`select save_tenant($1, '{}', '{}')`, [{ id: t.id, plan_key: 'hsg_essentials' }]));
    const prefs = await one(db, 'select * from newsletter_preferences where tenant_id = $1', [t.id]);
    assert.equal(prefs.template_key, null);
    assert.equal(prefs.cadence, 'biweekly');
    const after = await campaign(db, c.id);
    assert.equal(after.rendered_html, before.rendered_html);
    assert.equal(after.template_version_id, before.template_version_id);
    assert.ok((await call(db, 'send_blockers', [c.id]))[0].send_blockers.includes('template_not_entitled'));
  });
});

describe('cadence', () => {
  test('biweekly gets exactly 26 of 52 weeks for either offset, weekly gets 52', async () => {
    const weekly = await addTenant(db);
    const even = await addTenant(db, { plan: 'hsg_essentials', cadence: 'biweekly', template: 'tips_insights', offset: 0 });
    const odd = await addTenant(db, { plan: 'hsg_essentials', cadence: 'biweekly', template: 'tips_insights', offset: 1 });
    const count = async (tenant) => (await one(db, `
      select count(*) filter (where tenant_receives_week($1, (date '2027-01-04' + (w * 7))::date))::int as n from generate_series(0, 51) w`, [tenant.id])).n;
    assert.equal(await count(weekly), 52);
    assert.equal(await count(even), 26);
    assert.equal(await count(odd), 26);
    const both = await one(db, `select count(*)::int as n from generate_series(0, 51) w
      where tenant_receives_week($1, (date '2027-01-04' + (w * 7))::date) and tenant_receives_week($2, (date '2027-01-04' + (w * 7))::date)`, [even.id, odd.id]);
    assert.equal(both.n, 0, 'the offset decides which alternating editions a tenant gets');
  });
});

describe('content routing', () => {
  test('two roofing clients share editorial content but keep their own brand and sender', async () => {
    const a = await addTenant(db, { name: 'Roof A', areas: ['US-MT'] });
    const b = await addTenant(db, { name: 'Roof B', areas: ['US-MT'] });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(31) });
    await call(db, 'queue_edition_campaigns', [edition.id]);
    const bundles = (await call(db, 'claim_campaigns_for_render', [100])).map((r) => r.claim_campaigns_for_render);
    const brandOf = (tenant) => bundles.find((bundle) => bundle.brand.tenant_id === tenant.id);
    assert.equal(brandOf(a).hero.id, brandOf(b).hero.id);
    assert.notEqual(brandOf(a).brand.newsletter_name, brandOf(b).brand.newsletter_name);
    assert.notEqual(brandOf(a).brand.from_email, brandOf(b).brand.from_email);
    assert.notEqual(brandOf(a).brand.phone, brandOf(b).brand.phone);
    for (const bundle of bundles) await db.query('select record_render_failure($1, $2)', [bundle.campaign_id, '["test"]']);
  });

  test('a brewery edition cannot carry roofing content and breweries never get roofing editions', async () => {
    const roofingStory = await addStory(db, { headline: 'Roof care' });
    const brewery = await addTenant(db, { division: 'hospitality', industry: 'brewery', plan: 'hospitality_pilot', template: 'premium_magazine' });
    await assert.rejects(addApprovedEdition(db, { division: 'hospitality', industry: 'brewery', week: mondayFromNow(32), hero: roofingStory }), /cannot go into/);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(32) });
    await call(db, 'queue_edition_campaigns', [edition.id]);
    assert.equal((await rows(db, 'select 1 from campaign_instances where edition_id = $1 and tenant_id = $2', [edition.id, brewery.id])).length, 0);
    for (const row of await call(db, 'claim_campaigns_for_render', [100])) await db.query('select record_render_failure($1, $2)', [row.claim_campaigns_for_render.campaign_id, '["test"]']);
  });

  test('a Colorado-only story never reaches a tenant outside Colorado', async () => {
    const texas = await addTenant(db, { areas: ['US-TX'] });
    const colorado = await addTenant(db, { areas: ['US-CO'] });
    const local = await addStory(db, { headline: 'Colorado hail', regions: ['US-CO'] });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(33), secondary: [local] });
    await call(db, 'queue_edition_campaigns', [edition.id]);
    const bundles = (await call(db, 'claim_campaigns_for_render', [100])).map((r) => r.claim_campaigns_for_render);
    const headlines = (tenant) => bundles.find((bundle) => bundle.brand.tenant_id === tenant.id).secondary.map((story) => story.headline);
    assert.deepEqual(headlines(colorado), ['Colorado hail']);
    assert.deepEqual(headlines(texas), []);
    for (const bundle of bundles) await db.query('select record_render_failure($1, $2)', [bundle.campaign_id, '["test"]']);
  });
});

describe('approval gates', () => {
  test('a review campaign cannot send without explicit approval of the current render', async () => {
    const t = await addTenant(db, { review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(4) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    assert.equal(c.status, 'CLIENT_REVIEW_PENDING');
    assert.equal((await claim()).filter((row) => row.campaign_id === c.id).length, 0);
    await assert.rejects(db.query(`update campaign_instances set status = 'APPROVED_FOR_SEND' where id = $1`, [c.id]), /Client approval/);
    await approveByReviewer(c);
    assert.equal((await campaign(db, c.id)).status, 'APPROVED_FOR_SEND');
  });

  test('an approval does not carry over to a new render', async () => {
    const t = await addTenant(db, { review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(5) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    const token = await approveByReviewer(c);
    await asStaff(() => db.query('select operator_rerender($1)', [c.id]));
    await publish(db, edition, '<html><span data-slot="legal">Changed</span><a data-slot="unsubscribe"></a></html>');
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'CLIENT_REVIEW_PENDING');
    assert.notEqual(after.rendered_html_hash, token.hash);
    assert.equal((await rows(db, `select 1 from approval_events where campaign_id = $1 and decision = 'revoked'`, [c.id])).length, 1);
    const view = (await call(db, 'review_view', [token.jti, token.cid, token.tid, token.hash]))[0].review_view;
    assert.notEqual(view.state, 'pending');
  });

  test('the reviewer cannot approve a version other than the one on the token', async () => {
    const t = await addTenant(db, { review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(6) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    const k = (await call(db, 'issue_review_token', [c.id]))[0].issue_review_token;
    await assert.rejects(
      db.query(`select review_decide($1, $2, $3, $4, 'approve', 'different-hash', null)`, [k.jti, k.cid, k.tid, k.hash]),
      /has changed since you opened it/,
    );
    await assert.rejects(db.query(`select review_decide($1, $2, $3, 'forged', 'approve', 'forged', null)`, [k.jti, k.cid, k.tid]), /not valid/);
    assert.equal((await campaign(db, c.id)).status, 'CLIENT_REVIEW_PENDING');
  });

  test('a token is single-decision, and a reissued link kills the old one', async () => {
    const t = await addTenant(db, { review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(7) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    const first = (await call(db, 'issue_review_token', [c.id]))[0].issue_review_token;
    const second = (await call(db, 'issue_review_token', [c.id]))[0].issue_review_token;
    await assert.rejects(db.query(`select review_decide($1, $2, $3, $4, 'approve', $4, null)`, [first.jti, first.cid, first.tid, first.hash]), /expired/);
    await db.query(`select review_decide($1, $2, $3, $4, 'approve', $4, null)`, [second.jti, second.cid, second.tid, second.hash]);
    await assert.rejects(db.query(`select review_decide($1, $2, $3, $4, 'skip', $4, null)`, [second.jti, second.cid, second.tid, second.hash]), /already been recorded/);
  });

  test('no reviewer response means HOLD, and the campaign is never auto-sent', async () => {
    const t = await addTenant(db, { review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(8) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    await db.query(`update campaign_instances set review_deadline = now() - interval '1 minute' where id = $1`, [c.id]);
    await call(db, 'hold_expired_reviews');
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'HELD');
    assert.equal(after.status_reason, 'review_deadline_missed');
    assert.equal((await claim()).filter((row) => row.campaign_id === c.id).length, 0);
  });

  test('request changes needs notes and skip cancels', async () => {
    const t = await addTenant(db, { review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(9) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    const k = (await call(db, 'issue_review_token', [c.id]))[0].issue_review_token;
    await assert.rejects(db.query(`select review_decide($1, $2, $3, $4, 'request_changes', $4, '  ')`, [k.jti, k.cid, k.tid, k.hash]), /describe the changes/);
    await db.query(`select review_decide($1, $2, $3, $4, 'skip', $4, null)`, [k.jti, k.cid, k.tid, k.hash]);
    assert.equal((await campaign(db, c.id)).status, 'CANCELED');
  });

  test('an automatic campaign cannot proceed without central approval', async () => {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(10) });
    await asStaff(() => db.query(`select save_edition($1)`, [{ id: edition.id, subject: 'Edited after approval' }]));
    await assert.rejects(call(db, 'queue_edition_campaigns', [edition.id]), /not centrally approved/);
    await assert.rejects(
      db.query(`insert into campaign_instances (tenant_id, edition_id, edition_version, idempotency_key, status) values ($1, $2, 1, 'x', 'APPROVED_FOR_SEND')`, [t.id, edition.id]),
      /must start at/,
    );
  });

  test('a post-approval edit holds unsent campaigns, bumps the version and needs re-approval', async () => {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(11) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    assert.equal(c.status, 'APPROVED_FOR_SEND');
    await asStaff(() => db.query(`select save_edition($1)`, [{ id: edition.id, subject: 'New subject' }]));
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'HELD');
    assert.equal(after.status_reason, 'edition_changed');
    const e = await one(db, 'select * from editions where id = $1', [edition.id]);
    assert.equal(e.status, 'draft');
    assert.equal(e.version, 2);
    await asStaff(() => assert.rejects(db.query('select operator_release($1)', [c.id]), /Central approval/));
  });

  test('saving an approved edition without changes keeps its approval', async () => {
    const edition = await addApprovedEdition(db, { week: mondayFromNow(12) });
    await asStaff(() => db.query(`select save_edition($1)`, [{ id: edition.id, subject: edition.subject }]));
    assert.equal((await one(db, 'select status from editions where id = $1', [edition.id])).status, 'approved');
  });

  test('changing a master template does not mutate an approved campaign', async () => {
    const t = await addTenant(db, { template: 'seasonal_guide' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(13) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    await db.query(`update template_versions set is_current = false where template_key = 'seasonal_guide' and is_current`);
    await db.query(`insert into template_versions (template_key, version, mjml_source, compiled_html, is_current) values ('seasonal_guide', 99, 'new', 'new', true)`);
    const after = await campaign(db, c.id);
    assert.equal(after.rendered_html_hash, c.rendered_html_hash);
    assert.equal(after.template_version_id, c.template_version_id);
    assert.equal(after.status, 'APPROVED_FOR_SEND');
    await assert.rejects(db.query(`update template_versions set compiled_html = 'changed' where template_key = 'seasonal_guide' and version <> 99`), /immutable/);
  });
});

describe('send blockers', () => {
  const blockedBy = async (id) => (await call(db, 'send_blockers', [id]))[0].send_blockers;

  test('an unverified sender blocks sending', async () => {
    const t = await addTenant(db, { verified: false });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(14) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    assert.equal(c.status, 'HELD');
    assert.match(c.status_reason, /sender_not_verified/);
  });

  test('a missing footer blocks sending', async () => {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(15) });
    const c = (await publish(db, edition, '<html>no footer here</html>')).find((row) => row.tenant_id === t.id);
    assert.equal(c.status, 'HELD');
    assert.match(c.status_reason, /missing_unsubscribe/);
    assert.match(c.status_reason, /missing_legal_footer/);
  });

  test('a paused tenant is skipped and resumes without losing its place', async () => {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(16) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    await db.query(`update tenants set status = 'paused' where id = $1`, [t.id]);
    assert.ok((await blockedBy(c.id)).includes('paused:tenant_inactive'));
    assert.equal((await claim()).filter((row) => row.campaign_id === c.id).length, 0);
    assert.equal((await campaign(db, c.id)).status, 'APPROVED_FOR_SEND');
    await db.query(`update tenants set status = 'active' where id = $1`, [t.id]);
  });

  test('every pause level stops dispatch', async () => {
    const t = await addTenant(db, { industry: 'plumbing' });
    const edition = await addApprovedEdition(db, { industry: 'plumbing', week: mondayFromNow(17) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    const scopes = [['global', '*'], ['division', 'hsg'], ['industry', 'plumbing'], ['tenant', t.id], ['edition', edition.id]];
    for (const [scope, value] of scopes) {
      await asStaff(() => db.query('select set_pause($1, $2, true, $3)', [scope, value, 'test']));
      assert.ok((await blockedBy(c.id)).includes('paused:switch'), scope);
      await asStaff(() => db.query('select set_pause($1, $2, false, $3)', [scope, value, 'test']));
      assert.ok(!(await blockedBy(c.id)).includes('paused:switch'), scope);
    }
  });

  test('a global pause pulls back campaigns already scheduled in GHL', async () => {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(18) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    await claim();
    assert.equal((await draftAndCheck(c.id, 'ghl-pause')).clear, true);
    await call(db, 'record_dispatch_result', [c.id, 'schedule', 'scheduled']);
    assert.equal((await campaign(db, c.id)).status, 'SCHEDULED');
    await asStaff(() => db.query(`select set_pause('global', '*', true, 'incident')`));
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'HELD');
    assert.ok(after.cancel_requested_at);
    assert.ok((await call(db, 'list_cancel_requests', [100])).some((row) => row.list_cancel_requests.campaign_id === c.id));
    await asStaff(() => db.query(`select set_pause('global', '*', false, 'over')`));
  });

  test('a revoked approval blocks sending at the final check', async () => {
    const t = await addTenant(db, { review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(19) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    await approveByReviewer(c);
    await claim();
    await call(db, 'record_ghl_draft', [c.id, 'ghl-revoke']);
    await asStaff(() => db.query('select operator_revoke_approval($1, $2)', [c.id, 'client changed their mind']));
    const check = (await call(db, 'pre_schedule_check', [c.id]))[0].pre_schedule_check;
    assert.equal(check.clear, false);
    assert.equal((await campaign(db, c.id)).status, 'HELD');
  });

  test('a late pause stops a campaign between the GHL draft and the schedule call', async () => {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(20) });
    const c = (await publish(db, edition)).find((row) => row.tenant_id === t.id);
    await claim();
    await asStaff(() => db.query(`select set_pause('tenant', $1, true, 'late')`, [t.id]));
    assert.equal((await draftAndCheck(c.id, 'ghl-late')).clear, false);
    await asStaff(() => db.query(`select set_pause('tenant', $1, false, 'over')`, [t.id]));
  });
});

describe('dispatch safety', () => {
  async function ready(week) {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(week) });
    return (await publish(db, edition)).find((row) => row.tenant_id === t.id);
  }

  test('the same tenant and edition can only ever have one campaign', async () => {
    const t = await addTenant(db);
    const edition = await addApprovedEdition(db, { week: mondayFromNow(21) });
    await call(db, 'queue_edition_campaigns', [edition.id]);
    await call(db, 'queue_edition_campaigns', [edition.id]);
    assert.equal((await rows(db, 'select 1 from campaign_instances where tenant_id = $1 and edition_id = $2', [t.id, edition.id])).length, 1);
    await assert.rejects(
      db.query(`insert into campaign_instances (tenant_id, edition_id, edition_version, idempotency_key) values ($1, $2, 1, $3)`, [t.id, edition.id, `${t.id}:${edition.id}:default`]),
      /duplicate key/,
    );
    for (const row of await call(db, 'claim_campaigns_for_render', [100])) await db.query('select record_render_failure($1, $2)', [row.claim_campaigns_for_render.campaign_id, '["test"]']);
  });

  test('a campaign already claimed is not claimed again', async () => {
    const c = await ready(22);
    assert.equal((await claim()).filter((row) => row.campaign_id === c.id).length, 1);
    assert.equal((await claim()).filter((row) => row.campaign_id === c.id).length, 0);
  });

  test('an unknown outcome is never re-dispatched until reconciled', async () => {
    const c = await ready(23);
    await claim();
    await call(db, 'record_dispatch_result', [c.id, 'create', 'unknown', 503, 'gateway']);
    assert.equal((await claim()).filter((row) => row.campaign_id === c.id).length, 0);
    await db.query(`update campaign_instances set status = 'FAILED' where id = $1`, [c.id]);
    await asStaff(() => assert.rejects(db.query('select operator_retry($1)', [c.id]), /unknown/));
    const listed = (await call(db, 'list_campaigns_to_reconcile', [100])).map((row) => row.list_campaigns_to_reconcile.campaign_id);
    assert.ok(listed.includes(c.id));
  });

  test('reconciling a found draft reuses it, so a retry cannot create a duplicate', async () => {
    const c = await ready(24);
    await claim();
    await call(db, 'record_dispatch_result', [c.id, 'create', 'unknown', 504, 'timeout']);
    await db.query(`select record_reconcile($1, true, true, 'ghl-found', 'draft', 200)`, [c.id]);
    const again = (await claim()).find((row) => row.campaign_id === c.id);
    assert.equal(again.ghl_campaign_id, 'ghl-found', 'the second attempt skips creating a draft');
  });

  test('reconciling a found scheduled campaign marks it scheduled without another call', async () => {
    const c = await ready(25);
    await claim();
    await call(db, 'record_ghl_draft', [c.id, 'ghl-sched']);
    await call(db, 'record_dispatch_result', [c.id, 'schedule', 'unknown', 502, 'bad gateway']);
    await db.query(`select record_reconcile($1, true, true, 'ghl-sched', 'scheduled', 200)`, [c.id]);
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'SCHEDULED');
    assert.equal((await claim()).filter((row) => row.campaign_id === c.id).length, 0);
  });

  test('an unreachable GHL leaves the outcome unknown and raises an alert', async () => {
    const c = await ready(26);
    await claim();
    await call(db, 'record_dispatch_result', [c.id, 'create', 'unknown', 503, 'down']);
    await db.query('select record_reconcile($1, false, null, null, null, 503)', [c.id]);
    assert.equal((await campaign(db, c.id)).dispatch_state, 'unknown');
    assert.ok(await one(db, `select 1 from ops_alerts where kind = 'reconcile_unreachable' and campaign_id = $1`, [c.id]));
  });

  test('a worker crash becomes unknown instead of being retried', async () => {
    const c = await ready(27);
    await claim();
    await db.query(`update campaign_instances set dispatch_started_at = now() - interval '20 minutes' where id = $1`, [c.id]);
    await call(db, 'list_campaigns_to_reconcile', [100]);
    assert.equal((await campaign(db, c.id)).dispatch_state, 'unknown');
  });

  test('transient errors back off, then dead-letter with an alert', async () => {
    const c = await ready(28);
    await db.query(`update campaign_instances set dispatch_attempts = 4 where id = $1`, [c.id]);
    await claim();
    await call(db, 'record_dispatch_result', [c.id, 'create', 'retry_safe', 429, 'slow down']);
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'FAILED');
    assert.ok(after.dead_lettered_at);
    assert.ok(await one(db, `select 1 from ops_alerts where kind = 'dead_letter' and campaign_id = $1`, [c.id]));
  });

  test('a stale draft is not scheduled when the HTML changed', async () => {
    const c = await ready(29);
    await claim();
    await call(db, 'record_ghl_draft', [c.id, 'ghl-stale']);
    await db.query(`update campaign_instances set ghl_draft_hash = 'older' where id = $1`, [c.id]);
    assert.equal((await call(db, 'pre_schedule_check', [c.id]))[0].pre_schedule_check.clear, false);
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'READY_TO_RENDER');
    assert.ok(after.cancel_requested_at, 'the old GHL draft is queued for deletion');
    await db.query(`update campaign_instances set status = 'CANCELED' where id = $1`, [c.id]);
  });

  test('a late GHL success on a canceled campaign requests cancellation', async () => {
    const c = await ready(34);
    await claim();
    await call(db, 'record_ghl_draft', [c.id, 'ghl-race']);
    await asStaff(() => db.query('select operator_cancel($1, $2)', [c.id, 'stop']));
    await call(db, 'record_dispatch_result', [c.id, 'schedule', 'scheduled']);
    const after = await campaign(db, c.id);
    assert.equal(after.status, 'CANCELED');
    assert.ok(after.cancel_requested_at);
  });

  test('live dispatch is blocked until a daily cap is set', async () => {
    const c = await ready(35);
    await db.exec(`update system_settings set value = 'false' where key = 'ghl_dry_run'; update system_settings set value = 'null' where key = 'daily_send_cap';`);
    assert.equal((await claim()).length, 0);
    await db.exec(`update system_settings set value = '100000' where key = 'daily_send_cap';`);
    assert.ok((await claim()).some((row) => row.campaign_id === c.id));
    await db.exec(`update system_settings set value = 'true' where key = 'ghl_dry_run';`);
  });

  test('test-mode tenants only ever address test contacts', async () => {
    const c = await ready(36);
    const body = (await claim()).find((row) => row.campaign_id === c.id).ghl_schedule_body;
    assert.deepEqual(body.recipients, { type: 'contact', contactIds: ['contact-1'] });
  });

  test('a tenant only goes live after the checklist, and safe test mode overrides it', async () => {
    const t = await addTenant(db);
    await asStaff(() => assert.rejects(db.query('select set_live_send($1, true)', [t.id]), /checklist/));
    await asStaff(() => db.query('select mark_test_email_passed($1)', [t.id]));
    await asStaff(() => db.query('select set_live_send($1, true)', [t.id]));
    assert.deepEqual((await call(db, 'campaign_audience', [t.id]))[0].campaign_audience, { type: 'tag', tagIds: ['tag-1'] });
    await db.exec(`update system_settings set value = 'true' where key = 'safe_test_mode';`);
    assert.equal((await call(db, 'campaign_audience', [t.id]))[0].campaign_audience.type, 'contact');
    await db.exec(`update system_settings set value = '"production"' where key = 'environment'; update system_settings set value = 'false' where key = 'safe_test_mode'; update system_settings set value = '["internal@example.com"]' where key = 'internal_preview_addresses';`);
  });

  test('the hospitality plan stays test-only while its terms are pending', async () => {
    const t = await addTenant(db, { division: 'hospitality', industry: 'brewery', plan: 'hospitality_pilot', template: 'premium_magazine' });
    await asStaff(() => db.query('select mark_test_email_passed($1)', [t.id]));
    await asStaff(() => assert.rejects(db.query('select set_live_send($1, true)', [t.id]), /checklist/));
  });

  test('illegal status moves are refused even for the service role', async () => {
    const c = await ready(37);
    await as(db, 'service_role', null, () => assert.rejects(db.query(`update campaign_instances set status = 'SENT' where id = $1`, [c.id]), /Illegal campaign transition/));
  });
});

describe('isolation and audit', () => {
  let a;
  let b;
  let campaignB;

  before(async () => {
    a = await addTenant(db, { name: 'Isolated A', review: 'review' });
    b = await addTenant(db, { name: 'Isolated B', review: 'review' });
    const edition = await addApprovedEdition(db, { week: mondayFromNow(38) });
    const made = await publish(db, edition);
    campaignB = made.find((row) => row.tenant_id === b.id);
    tenantUserA = (await one(db, `insert into auth.users (email) values ('owner@a.example.com') returning id`)).id;
    await db.query('insert into tenant_users values ($1, $2)', [tenantUserA, a.id]);
    await db.query(`insert into campaign_metrics (campaign_id, tenant_id, recipients) values ($1, $2, 10)`, [campaignB.id, b.id]);
    await approveByReviewer(campaignB);
  });

  test('Tenant A cannot see Tenant B data', async () => {
    await as(db, 'authenticated', tenantUserA, async () => {
      assert.deepEqual((await db.query('select id from tenants')).rows.map((row) => row.id), [a.id]);
      for (const table of ['brand_profiles', 'newsletter_preferences', 'campaign_instances', 'approval_events', 'campaign_metrics']) {
        const leaked = await db.query(`select 1 from ${table} where tenant_id = $1`, [b.id]);
        assert.equal(leaked.rows.length, 0, table);
      }
      assert.equal((await db.query('select 1 from campaign_overview where tenant_id = $1', [b.id])).rows.length, 0);
      assert.equal((await db.query('select 1 from audit_log where tenant_id = $1', [b.id])).rows.length, 0);
    });
  });

  test('Tenant A cannot change anything, directly or through RPCs', async () => {
    await as(db, 'authenticated', tenantUserA, async () => {
      await assert.rejects(db.query(`update brand_profiles set phone = 'x' where tenant_id = $1`, [a.id]), /permission denied/);
      await assert.rejects(db.query('select operator_hold($1)', [campaignB.id]), /role does not allow/);
      await assert.rejects(db.query(`select set_pause('global', '*', true, 'x')`), /role does not allow/);
      await assert.rejects(db.query('select record_render($1, $2, $3, $4)', [campaignB.id, 'x', 'x', 'x']), /permission denied/);
      await assert.rejects(db.query('select get_ghl_token($1)', ['loc-1']), /permission denied/);
    });
  });

  test('anonymous visitors can read nothing and call nothing', async () => {
    await as(db, 'anon', null, async () => {
      for (const table of ['tenants', 'campaign_instances', 'review_tokens', 'audit_log', 'system_settings', 'campaign_overview']) {
        await assert.rejects(db.query(`select 1 from ${table}`), /permission denied/, table);
      }
      await assert.rejects(db.query('select review_decide(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), $1, $2, $1, null)', ['x', 'approve']), /permission denied/);
      await assert.rejects(db.query('select issue_review_token(gen_random_uuid())'), /permission denied/);
      await assert.rejects(db.query('select review_config()'), /permission denied/);
    });
  });

  test('review tokens are hidden from staff too', async () => {
    await asStaff(async () => {
      assert.equal((await db.query('select 1 from review_tokens')).rows.length, 0);
    });
  });

  test('role limits apply: an editor cannot pause and an operator cannot publish', async () => {
    const editor = (await one(db, `insert into auth.users (email) values ('editor@example.com') returning id`)).id;
    const operator = (await one(db, `insert into auth.users (email) values ('operator@example.com') returning id`)).id;
    await db.query(`insert into staff_roles values ($1, 'editor'), ($2, 'operator')`, [editor, operator]);
    await as(db, 'authenticated', editor, () => assert.rejects(db.query(`select set_pause('global', '*', true, 'x')`), /role does not allow/));
    await as(db, 'authenticated', operator, () => assert.rejects(db.query('select save_content($1)', [{ headline: 'x' }]), /role does not allow/));
    await as(db, 'authenticated', operator, () => assert.rejects(db.query(`select set_setting('ghl_dry_run', 'false')`), /role does not allow/));
  });

  test('the audit log and approval events are append-only', async () => {
    await assert.rejects(db.query(`update audit_log set actor = 'x' where id = (select min(id) from audit_log)`), /append-only/);
    await assert.rejects(db.query('delete from audit_log'), /append-only/);
    await assert.rejects(db.query('truncate audit_log'), /append-only/);
    await assert.rejects(db.query('delete from approval_events'), /append-only/);
  });

  test('operator actions record who did them, and brand changes keep before and after', async () => {
    const t = await addTenant(db);
    await asStaff(() => db.query(`select save_tenant($1, $2, '{}')`, [{ id: t.id }, { logo_url: 'https://example.com/new.png' }]));
    const entry = await one(db, `select * from audit_log where tenant_id = $1 and action = 'tenant.updated' order by id desc limit 1`, [t.id]);
    assert.equal(entry.actor, 'admin@example.com');
    assert.equal(entry.details.brand.logo_url.to, 'https://example.com/new.png');
    assert.equal(entry.details.brand.logo_url.from, null);
  });

  test('save_tenant cannot be used to switch on live sending', async () => {
    const t = await addTenant(db);
    await asStaff(() => db.query(`select save_tenant($1, '{}', '{}')`, [{ id: t.id, live_send_enabled: true, test_mode: false }]));
    const after = await one(db, 'select live_send_enabled, test_mode from tenants where id = $1', [t.id]);
    assert.equal(after.live_send_enabled, false);
    assert.equal(after.test_mode, true);
  });
});

describe('editorial workflow', () => {
  test('content moves only through the review steps and locks on approval', async () => {
    await asStaff(async () => {
      const id = (await db.query(`select save_content($1) as id`, [{ division: 'hsg', industry: 'roofing', headline: 'New' }])).rows[0].id;
      await assert.rejects(db.query(`select content_advance($1, 'approved')`, [id]), /cannot move/);
      await db.query(`select content_advance($1, 'editorial_review')`, [id]);
      await db.query(`select content_advance($1, 'fact_rights_review')`, [id]);
      await db.query(`select content_advance($1, 'approved')`, [id]);
      await assert.rejects(db.query(`select save_content($1)`, [{ id, headline: 'Changed' }]), /Only drafts/);
      const next = (await db.query('select content_new_version($1) as id', [id])).rows[0].id;
      const row = (await db.query('select version, status from content_items where id = $1', [next])).rows[0];
      assert.equal(row.version, 2);
      assert.equal(row.status, 'draft');
    });
  });

  test('an edition goes from draft to approved to queued through the staff functions', async () => {
    const t = await addTenant(db, { industry: 'electrical' });
    const story = await addStory(db, { industry: 'electrical' });
    await asStaff(async () => {
      const id = (await db.query('select save_edition($1) as id', [{ division: 'hsg', industry: 'electrical', publication_week: mondayFromNow(39), subject: 'Sparks' }])).rows[0].id;
      await assert.rejects(db.query('select edition_submit($1)', [id]), /hero/);
      await db.query('select set_edition_items($1, $2)', [id, JSON.stringify([{ content_item_id: story.id, slot: 'hero', position: 0 }])]);
      await assert.rejects(db.query('select edition_approve($1)', [id]), /Submit/);
      await db.query('select edition_submit($1)', [id]);
      await db.query('select edition_approve($1)', [id]);
      globalThis.editionId = id;
    });
    assert.ok((await call(db, 'list_editions_to_queue')).some((row) => row.list_editions_to_queue.edition_id === globalThis.editionId));
    await call(db, 'queue_edition_campaigns', [globalThis.editionId]);
    assert.ok(await one(db, 'select 1 from campaign_instances where tenant_id = $1 and edition_id = $2', [t.id, globalThis.editionId]));
    assert.ok((await one(db, 'select approved_snapshot from editions where id = $1', [globalThis.editionId])).approved_snapshot);
  });

  test('the dashboard reads through RLS and returns its cards', async () => {
    await asStaff(async () => {
      const cards = (await db.query(`select dashboard_cards('{}') as c`)).rows[0].c;
      assert.ok(cards.active_tenants > 0);
      assert.equal(cards.cost_estimate_usd, null);
      assert.ok((await db.query('select * from go_live_checklist((select id from tenants limit 1))')).rows.length);
    });
  });
});
