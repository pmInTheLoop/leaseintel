// Business-logic tests against a real database (PGlite in-process; Postgres when TEST_DATABASE_URL is set).
// Covers validation, transactions and rollback, approval rules, audit history, amendments, isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INDIRANAGAR, HSR, DUBAI } from './fixtures/samples.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaseintel-logic-'));
process.env.PGLITE_DIR = dir;
process.env.LEASEINTEL_TEST_HOOKS = '1';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getDb } = await import('../src/db.js');
const L = await import('../src/logic.js');

let db; let ws; let other;
const fresh = () => JSON.parse(JSON.stringify(INDIRANAGAR.payload));
const count = async (sql, params) => Number((await db.query(sql, params))[0].n);
async function newWorkspace(name) {
  const r = await db.query("INSERT INTO workspaces (name, mcp_key) VALUES ($1, $2) RETURNING id", [name, `li_test_${name}_${Date.now()}_${Math.random()}`]);
  return r[0].id;
}
async function verifyAll(leaseId, who = 'Anita Rao') {
  const d = await L.getLease(db, ws, leaseId);
  for (const k of d.review.missing_required) await L.verifyTerm(db, ws, leaseId, k, who, true);
}

before(async () => { db = await getDb(); ws = await newWorkspace('logic'); other = await newWorkspace('other'); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ---------- validation ----------
test('validation: impossible dates, fractional months, too many decimals, bad enums are rejected', () => {
  assert.throws(() => L.cleanField('start_date', '2023-02-29'), /real calendar date/);
  assert.throws(() => L.cleanField('expiry_date', '2024-04-31'), /real calendar date/);
  assert.equal(L.cleanField('start_date', '2024-02-29'), '2024-02-29');
  for (const k of ['lock_in_months', 'notice_months', 'escalation_every_months', 'renewal_term_months']) {
    assert.throws(() => L.cleanField(k, 36.5), /whole number of months/, k);
    assert.throws(() => L.cleanField(k, '2.5'), /whole number of months/, k);
  }
  assert.equal(L.cleanField('lock_in_months', '36'), 36);
  assert.throws(() => L.cleanField('monthly_rent', 100.123), /2 decimal places/);
  assert.equal(L.cleanField('monthly_rent', '1,80,000'), '180000');
  assert.equal(L.cleanField('escalation_percent', 7.25), '7.25');
  assert.throws(() => L.cleanField('tax_percent', 140), /above 100/);
  assert.throws(() => L.cleanField('payment_due_day', 7.5), /whole number/);
  assert.throws(() => L.cleanField('tax_on_rent', 'maybe'), /one of/);
  assert.throws(() => L.cleanField('monthly_rent', -5), /0 or more/);
  assert.throws(() => L.cleanField('monthly_rent', { x: 1 }), /single value/);
});

test('Claude must give evidence for every key term it sends', async () => {
  const p = fresh();
  p.evidence = p.evidence.filter((e) => e.field !== 'monthly_rent');
  await assert.rejects(L.createLease(db, ws, p, 'claude'), /evidence entry.*monthly_rent/);
  assert.equal(await count('SELECT count(*)::int n FROM leases WHERE workspace_id = $1', [ws]), 0);
});

// ---------- 4.1 transactions ----------
// Sequential on purpose: the local Postgres wire test server accepts one connection at a time.
const counts = async () => { const out = []; for (const t of ['locations', 'leases', 'activity']) out.push(await count(`SELECT count(*)::int n FROM ${t} WHERE workspace_id = $1`, [ws])); return out; };

test('a failed create rolls back every write (location, lease, terms, clauses, activity)', async () => {
  const before = await counts();
  await assert.rejects(L.createLease(db, ws, { ...fresh(), __failAfterInsert: true }, 'claude'), /simulated failure/);
  const after = await counts();
  assert.deepEqual(after, before);
  assert.equal(await count('SELECT count(*)::int n FROM lease_terms t LEFT JOIN leases l ON l.id = t.lease_id WHERE l.id IS NULL'), 0);
});

test('an outer transaction that fails rolls back a completed create and update inside it', async () => {
  const before = await count('SELECT count(*)::int n FROM leases WHERE workspace_id = $1', [ws]);
  await assert.rejects(db.tx(async (t) => {
    const id = await L.createLease(t, ws, fresh(), 'claude');
    await L.updateLeaseFields(t, ws, id, { title: 'renamed' }, 'team:A', { byPerson: true, personName: 'A' });
    throw new Error('boom');
  }), /boom/);
  assert.equal(await count('SELECT count(*)::int n FROM leases WHERE workspace_id = $1', [ws]), before);
});

// ---------- creation, duplicates ----------
test('create from Claude: unverified terms with quotes; retry is rejected as a duplicate', async () => {
  const id = await L.createLease(db, ws, fresh(), 'claude');
  const d = await L.getLease(db, ws, id, '2026-11-11');
  assert.equal(d.status, 'needs_review');
  assert.equal(d.lease.monthly_rent, '180000');
  assert.equal(d.terms.find((t) => t.key === 'monthly_rent').evidence.verified, false);
  assert.match(d.terms.find((t) => t.key === 'escalation_percent').evidence.clause_quote, /last paid license fee/);
  assert.equal(d.ambiguities.length, 1);
  assert.equal(d.ambiguities[0].field, 'lock_in_notice_policy');
  await assert.rejects(L.createLease(db, ws, fresh(), 'claude'), (e) => e.status === 409 && /already exists/.test(e.message));
  const dupOk = await L.createLease(db, ws, { ...fresh(), allow_duplicate: true }, 'claude');
  assert.ok(dupOk > id);
  await L.setLeaseArchived(db, ws, dupOk, true, 'team:A');
});

// ---------- approval rules ----------
test('approval needs every key term verified, including terms that become key (tax scope, notice policy)', async () => {
  const id = await L.createLease(db, ws, { ...JSON.parse(JSON.stringify(DUBAI.payload)) }, 'claude');
  let d = await L.getLease(db, ws, id);
  assert.ok(d.review.required.includes('tax_on_charges'));
  assert.ok(d.review.required.includes('lock_in_notice_policy'));
  assert.ok(!d.review.required.includes('escalation_basis')); // no escalation in this lease
  await assert.rejects(L.approveLease(db, ws, id, 'Anita Rao'), /Verify these terms first/);
  await verifyAll(id);
  await L.approveLease(db, ws, id, 'Anita Rao');
  d = await L.getLease(db, ws, id);
  assert.equal(d.lease.status, 'approved');
  assert.deepEqual(d.warnings.map((w) => w.code), ['lock_in_notice_policy', 'tax_on_charges']); // verified "unknown" stays a visible warning
  assert.equal(d.money.totals_final, false);
});

test('a Claude change to a key term on an approved lease reopens it; the audit row keeps old and new values', async () => {
  const id = await L.createLease(db, ws, { ...JSON.parse(JSON.stringify(HSR.payload)) }, 'claude');
  await verifyAll(id);
  await L.approveLease(db, ws, id, 'Anita Rao');
  await assert.rejects(L.updateLeaseFields(db, ws, id, { monthly_rent: 97000 }, 'claude'), /evidence/);
  const r = await L.updateLeaseFields(db, ws, id, { monthly_rent: 97000, evidence: [{ field: 'monthly_rent', clause_quote: 'Rs. 97,000/-', clause_ref: 'Clause 3.1' }] }, 'claude');
  assert.deepEqual(r, { changed: ['monthly_rent'], reopened: true });
  const d = await L.getLease(db, ws, id);
  assert.equal(d.lease.status, 'needs_review');
  assert.equal(d.terms.find((t) => t.key === 'monthly_rent').evidence.verified, false);
  const row = d.activity.find((a) => a.action === 'term.changed' && a.field === 'monthly_rent');
  assert.equal(row.old_value, '95000');
  assert.equal(row.new_value, '97000');
  assert.equal(row.source, 'claude');
  assert.match(row.reason, /Clause 3\.1/);
  assert.ok(d.activity.some((a) => a.action === 'lease.reopened'));
});

test('a person correcting a value records old → new and verifies it under their name', async () => {
  const id = await L.createLease(db, ws, { ...fresh(), escalation_percent: 5, allow_duplicate: true }, 'claude');
  await L.updateLeaseFields(db, ws, id, { escalation_percent: 15, reason: 'Clause 4.1 says 15%' }, 'team:Anita Rao', { byPerson: true, personName: 'Anita Rao' });
  const d = await L.getLease(db, ws, id);
  const t = d.terms.find((x) => x.key === 'escalation_percent').evidence;
  assert.equal(t.verified, true);
  assert.equal(t.corrected, true);
  assert.equal(t.verified_by, 'Anita Rao');
  const row = d.activity.find((a) => a.field === 'escalation_percent');
  assert.deepEqual([row.old_value, row.new_value, row.source, row.reason], ['5', '15', 'person', 'Clause 4.1 says 15%']);
  assert.equal(d.schedule.at(-1).rent, 238050);
});

test('a person adding a tax rate to an approved lease makes tax scope a key term and reopens it', async () => {
  const id = await L.createLease(db, ws, { ...fresh(), tax_percent: null, tax_on_rent: null, tax_on_charges: null, allow_duplicate: true,
    evidence: fresh().evidence.filter((e) => !e.field.startsWith('tax')) }, 'claude');
  await verifyAll(id);
  await L.approveLease(db, ws, id, 'Anita Rao');
  const r = await L.updateLeaseFields(db, ws, id, { tax_percent: 18 }, 'team:Anita Rao', { byPerson: true, personName: 'Anita Rao' });
  assert.equal(r.reopened, true);
  const d = await L.getLease(db, ws, id);
  assert.ok(d.review.missing_required.includes('tax_on_rent'));
});

test('unverifying a key term reopens an approved lease', async () => {
  const id = await L.createLease(db, ws, { ...JSON.parse(JSON.stringify(HSR.payload)), allow_duplicate: true }, 'claude');
  await verifyAll(id);
  await L.approveLease(db, ws, id, 'A');
  await L.verifyTerm(db, ws, id, 'expiry_date', 'A', false);
  assert.equal((await L.getLease(db, ws, id)).lease.status, 'needs_review');
});

test('audit history is append-only: UPDATE on activity has no effect', async () => {
  const before = await db.query('SELECT id, action FROM activity WHERE workspace_id = $1 ORDER BY id LIMIT 1', [ws]);
  await db.query("UPDATE activity SET action = 'tampered' WHERE id = $1", [before[0].id]);
  const afterRow = await db.query('SELECT action FROM activity WHERE id = $1', [before[0].id]);
  assert.equal(afterRow[0].action, before[0].action);
});

// ---------- 4.4 consistency ----------
test('stale action keys are rejected after a date changes; done marks do not carry over', async () => {
  const id = await L.createLease(db, ws, { ...fresh(), allow_duplicate: true }, 'claude');
  let d = await L.getLease(db, ws, id, '2026-11-11');
  const renewal = d.dates.find((x) => x.type === 'renewal_notice');
  await L.setActionDone(db, ws, id, renewal.action_key, true, 'Sent by courier', 'team:A');
  await L.updateLeaseFields(db, ws, id, { expiry_date: '2027-07-31' }, 'team:A', { byPerson: true, personName: 'A' });
  d = await L.getLease(db, ws, id, '2026-11-11');
  const moved = d.dates.find((x) => x.type === 'renewal_notice');
  assert.equal(moved.date, '2027-01-31');
  assert.notEqual(moved.state, 'done');
  await assert.rejects(L.setActionDone(db, ws, id, renewal.action_key, true, '', 'claude'), (e) => e.status === 409);
});

test('a repeated save_document returns the same draft instead of a duplicate', async () => {
  const id = (await db.query('SELECT id FROM leases WHERE workspace_id = $1 ORDER BY id LIMIT 1', [ws]))[0].id;
  const a = await L.saveDocument(db, ws, id, { title: 'Renewal notice', body: 'Dear Sir' }, 'claude');
  const b = await L.saveDocument(db, ws, id, { title: 'Renewal notice', body: 'Dear Sir' }, 'claude');
  assert.equal(a, b);
  await L.updateDocument(db, ws, a, { body: 'Dear Mr. Gowda', status: 'sent' }, 'team:A');
  const d = await L.getLease(db, ws, id);
  assert.equal(d.documents.find((x) => x.id === a).status, 'sent');
  assert.ok(d.activity.some((x) => x.action === 'document.status' && x.old_value === 'draft' && x.new_value === 'sent'));
});

// ---------- 6.4 amendments ----------
test('amendment: proposed changes leave the lease untouched until a person accepts; old values stay in history', async () => {
  const id = await L.createLease(db, ws, { ...fresh(), allow_duplicate: true }, 'claude');
  await verifyAll(id);
  await L.approveLease(db, ws, id, 'Anita Rao');
  const p = await L.proposeAmendment(db, ws, id, {
    title: 'Addendum 1 dated 2026-10-01', effective_date: '2026-10-01',
    changes: [
      { field: 'monthly_rent', new_value: 185000, clause_quote: 'the license fee shall be Rs. 1,85,000/- per month', clause_ref: 'Clause 2' },
      { field: 'expiry_date', new_value: '2029-06-30', clause_quote: 'the Term is extended to 30th June 2029', clause_ref: 'Clause 1' },
      { field: 'cam_monthly', new_value: 30000, clause_quote: 'maintenance charges remain Rs. 30,000/-', clause_ref: 'Clause 3' },
    ],
  }, 'claude');
  assert.equal(p.proposed.length, 2); // CAM is unchanged, so it is not proposed
  assert.equal(p.unchanged, 1);
  let d = await L.getLease(db, ws, id);
  assert.equal(d.lease.monthly_rent, '180000');
  assert.equal(d.lease.status, 'approved');
  assert.equal(d.pending_changes, 2);
  await assert.rejects(L.approveLease(db, ws, id, 'A').then(() => L.updateLeaseFields(db, ws, id, { notes: 'x' }, 'team:A', { byPerson: true, personName: 'A' })).then(() => L.verifyTerm(db, ws, id, 'monthly_rent', 'A', false)).then(() => L.approveLease(db, ws, id, 'A')), /pending amendment/);
  await L.verifyTerm(db, ws, id, 'monthly_rent', 'A', true);

  const rentChange = d.amendments[0].changes.find((c) => c.field === 'monthly_rent');
  await L.decideAmendment(db, ws, p.amendment_id, { changeId: rentChange.id, decision: 'accept' }, 'Anita Rao');
  await L.decideAmendment(db, ws, p.amendment_id, { decision: 'reject' }, 'Anita Rao');
  d = await L.getLease(db, ws, id, '2026-11-11');
  assert.equal(d.lease.monthly_rent, '185000');
  assert.equal(d.lease.expiry_date, '2027-06-30'); // rejected
  assert.equal(d.schedule[0].rent, 185000);
  const ev = d.terms.find((t) => t.key === 'monthly_rent').evidence;
  assert.equal(ev.source, 'amendment');
  assert.equal(ev.verified_by, 'Anita Rao');
  assert.match(ev.clause_ref, /Addendum 1/);
  const row = d.activity.find((a) => a.action === 'term.changed' && a.field === 'monthly_rent');
  assert.deepEqual([row.old_value, row.new_value, row.source], ['180000', '185000', 'amendment']);
  assert.ok(d.activity.some((a) => a.action === 'amendment.rejected' && a.field === 'expiry_date'));
  await L.approveLease(db, ws, id, 'Anita Rao');
});

test('amendment: a change proposed against an old value is refused if the lease moved on', async () => {
  const id = await L.createLease(db, ws, { ...fresh(), allow_duplicate: true }, 'claude');
  const p = await L.proposeAmendment(db, ws, id, { title: 'Addendum 2', changes: [{ field: 'cam_monthly', new_value: 35000, clause_quote: 'CAM Rs. 35,000/-' }] }, 'claude');
  await L.updateLeaseFields(db, ws, id, { cam_monthly: 32000 }, 'team:A', { byPerson: true, personName: 'A' });
  await assert.rejects(L.decideAmendment(db, ws, p.amendment_id, { decision: 'accept' }, 'A'), (e) => e.status === 409 && /changed after/.test(e.message));
  await assert.rejects(L.proposeAmendment(db, ws, id, { title: 'x', changes: [{ field: 'start_date', new_value: '2023-02-29', clause_quote: 'q' }] }, 'claude'), /real calendar date/);
  await assert.rejects(L.proposeAmendment(db, ws, id, { title: 'x', changes: [{ field: 'cam_monthly', new_value: 32000, clause_quote: 'q' }] }, 'claude'), /None of these values differ/);
});

// ---------- isolation ----------
test('workspace isolation: another workspace cannot read or change these records', async () => {
  const id = (await db.query('SELECT id FROM leases WHERE workspace_id = $1 ORDER BY id LIMIT 1', [ws]))[0].id;
  await assert.rejects(L.getLease(db, other, id), (e) => e.status === 404);
  await assert.rejects(L.updateLeaseFields(db, other, id, { notes: 'x' }, 'claude'), (e) => e.status === 404);
  await assert.rejects(L.verifyTerm(db, other, id, 'monthly_rent', 'X'), (e) => e.status === 404);
  await assert.rejects(L.approveLease(db, other, id, 'X'), (e) => e.status === 404);
  await assert.rejects(L.saveDocument(db, other, id, { title: 't', body: 'b' }, 'claude'), (e) => e.status === 404);
  await assert.rejects(L.setActionDone(db, other, id, 'expiry:2027-06-30', true, '', 'claude'), (e) => e.status === 404);
  const am = (await db.query('SELECT id FROM amendments WHERE workspace_id = $1 LIMIT 1', [ws]))[0].id;
  await assert.rejects(L.decideAmendment(db, other, am, { decision: 'accept' }, 'X'), (e) => e.status === 404);
  const p = await L.portfolio(db, other);
  assert.equal(p.leases.length, 0);
  await assert.rejects(L.createLease(db, other, { ...fresh(), location: undefined, location_id: 1 }, 'claude'), (e) => e.status === 404);
});

test('portfolio: totals per currency from stored terms, never mixed; expired and archived excluded', async () => {
  const p = await L.portfolio(db, ws, { today: '2026-11-11' });
  assert.ok(p.totals_by_currency.INR);
  assert.ok(p.totals_by_currency.AED);
  assert.equal(p.totals_by_currency.AED.totals_final, false);
  assert.equal(p.totals_by_currency.AED.monthly_outflow_now, 16425);
  assert.equal(p.counts.locations, Number((await db.query('SELECT count(*)::int n FROM locations WHERE workspace_id = $1', [ws]))[0].n));
  const later = await L.portfolio(db, ws, { today: '2031-01-01' });
  assert.deepEqual(later.totals_by_currency, {}); // every lease has expired by then
});
