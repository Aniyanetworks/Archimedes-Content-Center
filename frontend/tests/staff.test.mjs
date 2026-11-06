// Staff management: admins list, invite, re-role and remove staff; nobody else can.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { handleStaffInvite } from '../supabase/functions/_shared/staff.ts';
import { as, createDb, one, rows } from './helpers.mjs';

let db;
let admin;
let editor;

async function addUser(email, role) {
  const id = (await one(db, `insert into auth.users (email, last_sign_in_at) values ($1, now()) returning id`, [email])).id;
  if (role) await db.query(`insert into staff_roles (user_id, role) values ($1, $2)`, [id, role]);
  return id;
}

const asUser = (id, work) => as(db, 'authenticated', id, work);

before(async () => {
  db = await createDb();
  admin = await addUser('admin@example.com', 'admin');
  editor = await addUser('editor@example.com', 'editor');
});

describe('staff SQL', () => {
  test('an admin sees every staff member with their email and role', async () => {
    const list = await asUser(admin, async () => (await one(db, 'select list_staff() as r')).r);
    assert.deepEqual(list.map((s) => [s.email, s.role]), [['admin@example.com', 'admin'], ['editor@example.com', 'editor']]);
    assert.equal(list.find((s) => s.email === 'admin@example.com').is_me, true);
  });

  test('non-admins cannot list, change or remove staff', async () => {
    await assert.rejects(asUser(editor, () => db.query('select list_staff()')), /does not allow/);
    await assert.rejects(asUser(editor, () => db.query(`select set_staff_role($1, 'admin')`, [editor])), /does not allow/);
    await assert.rejects(asUser(editor, () => db.query('select remove_staff($1)', [admin])), /does not allow/);
  });

  test('anonymous callers cannot run the functions at all', async () => {
    await assert.rejects(as(db, 'anon', null, () => db.query('select list_staff()')), /permission denied/);
    await assert.rejects(as(db, 'authenticated', admin, () => db.query(`select staff_user_id_by_email('x@example.com')`)), /permission denied/);
  });

  test('an admin can add an existing login, change a role, and every change is audited', async () => {
    const newcomer = await addUser('new@example.com', null);
    await asUser(admin, () => db.query(`select set_staff_role($1, 'operator')`, [newcomer]));
    await asUser(admin, () => db.query(`select set_staff_role($1, 'editor')`, [newcomer]));
    assert.equal((await one(db, 'select role from staff_roles where user_id = $1', [newcomer])).role, 'editor');
    const audit = await rows(db, `select actor, action, details from audit_log where details->>'email' = 'new@example.com' order by id`);
    assert.deepEqual(audit.map((a) => a.action), ['staff.added', 'staff.role_changed']);
    assert.equal(audit[0].actor, 'admin@example.com');
  });

  test('the last admin cannot be demoted or removed, and nobody can remove themselves', async () => {
    await assert.rejects(asUser(admin, () => db.query(`select set_staff_role($1, 'editor')`, [admin])), /at least one admin/);
    await assert.rejects(asUser(admin, () => db.query('select remove_staff($1)', [admin])), /your own access/);
  });

  test('with a second admin, one can step down', async () => {
    const second = await addUser('second@example.com', 'admin');
    await asUser(second, () => db.query(`select set_staff_role($1, 'operator')`, [second]));
    assert.equal((await one(db, 'select role from staff_roles where user_id = $1', [second])).role, 'operator');
  });

  test('removing access keeps the login and writes an audit entry', async () => {
    const leaver = await addUser('leaver@example.com', 'operator');
    await asUser(admin, () => db.query('select remove_staff($1)', [leaver]));
    assert.equal((await rows(db, 'select 1 from staff_roles where user_id = $1', [leaver])).length, 0);
    assert.equal((await rows(db, 'select 1 from auth.users where id = $1', [leaver])).length, 1);
    assert.equal((await one(db, `select action from audit_log where action = 'staff.removed' order by id desc limit 1`)).action, 'staff.removed');
  });
});

describe('staff-invite function', () => {
  function deps(overrides = {}) {
    const calls = [];
    return {
      calls,
      portalUrl: 'https://portal.example.com',
      extraOrigins: ['http://localhost:5173'],
      callerRole: async () => 'admin',
      invite: async (email, redirectTo) => { calls.push(['invite', email, redirectTo]); return 'new-user-id'; },
      findUser: async () => 'existing-id',
      setRole: async (_auth, id, role) => { calls.push(['setRole', id, role]); },
      ...overrides,
    };
  }
  const post = (body, headers = {}) => new Request('https://fn.example.com/staff-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token', Origin: 'https://portal.example.com', ...headers },
    body: JSON.stringify(body),
  });

  test('an admin invites a new person and the link returns to the portal', async () => {
    const d = deps();
    const response = await handleStaffInvite(post({ email: ' New@Example.com ', role: 'editor' }), d);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'invited', email: 'new@example.com' });
    assert.deepEqual(d.calls, [
      ['invite', 'new@example.com', 'https://portal.example.com/admin/reset-password?welcome=1'],
      ['setRole', 'new-user-id', 'editor'],
    ]);
  });

  test('an email that already has a login is added without a new invite', async () => {
    const d = deps({ invite: async () => null });
    const response = await handleStaffInvite(post({ email: 'old@example.com', role: 'operator' }), d);
    assert.deepEqual(await response.json(), { status: 'added', email: 'old@example.com' });
    assert.deepEqual(d.calls, [['setRole', 'existing-id', 'operator']]);
  });

  test('non-admins, missing tokens and bad input are refused', async () => {
    assert.equal((await handleStaffInvite(post({ email: 'a@b.co', role: 'editor' }), deps({ callerRole: async () => 'editor' }))).status, 403);
    assert.equal((await handleStaffInvite(post({ email: 'a@b.co', role: 'editor' }, { Authorization: '' }), deps())).status, 401);
    assert.equal((await handleStaffInvite(post({ email: 'not-an-email', role: 'editor' }), deps())).status, 400);
    assert.equal((await handleStaffInvite(post({ email: 'a@b.co', role: 'owner' }), deps())).status, 400);
  });

  test('local development gets its own redirect; unknown origins fall back to the portal', async () => {
    const local = deps();
    await handleStaffInvite(post({ email: 'a@b.co', role: 'editor' }, { Origin: 'http://localhost:5173' }), local);
    assert.equal(local.calls[0][2], 'http://localhost:5173/admin/reset-password?welcome=1');
    const evil = deps();
    const response = await handleStaffInvite(post({ email: 'a@b.co', role: 'editor' }, { Origin: 'https://evil.example.com' }), evil);
    assert.equal(evil.calls[0][2], 'https://portal.example.com/admin/reset-password?welcome=1');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://portal.example.com');
  });
});
