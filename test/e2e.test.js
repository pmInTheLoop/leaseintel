// End-to-end: a real MCP client (the same protocol Claude uses) talks to a real server process.
// Covers the assignment loop: request in Claude → record created → person edits/approves in the app →
// Claude reads the change → data survives a restart. Run: npm test
// Against real Postgres: TEST_DATABASE_URL=postgres://... npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { INDIRANAGAR } from './fixtures/samples.js';

const PORT = 4521;
const BASE = `http://localhost:${PORT}`;
const MCP_URL = `${BASE}/mcp/li_demo_volopay_2026`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaseintel-test-'));
let proc;
const S = {};

async function start() {
  proc = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(PORT), PGLITE_DIR: dataDir, DATABASE_URL: process.env.TEST_DATABASE_URL || '', SIGNUP_RATE_MAX: '4', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}
async function stop() { if (!proc) return; const p = new Promise((r) => proc.once('exit', r)); proc.kill('SIGTERM'); await p; proc = null; }
async function mcp() { const c = new Client({ name: 'e2e', version: '1' }); await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL))); return c; }
async function call(c, name, args) { const r = await c.callTool({ name, arguments: args }); const t = r.content[0].text; return { isError: Boolean(r.isError), text: t, json: r.isError ? null : JSON.parse(t) }; }
async function login(email = 'demo@leaseintel.app', password = 'leaseintel-demo') {
  const r = await fetch(`${BASE}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }) });
  assert.equal(r.status, 302);
  return r.headers.get('set-cookie').split(';')[0];
}
const api = (cookie, method, url, body) => fetch(BASE + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

before(start);
after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

// What Claude sends after reading samples/indiranagar-cafe-lease.pdf: the reference extraction (test/fixtures/samples.js)
// with one deliberate mistake a reviewer has to catch: 5% instead of 15% escalation.
const INDIRANAGAR_FROM_CLAUDE = { ...JSON.parse(JSON.stringify(INDIRANAGAR.payload)), escalation_percent: 5 };

test('MCP lists 8 tools with schemas and safety annotations', async () => {
  const c = await mcp();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['add_location', 'create_lease', 'get_lease', 'list_portfolio', 'mark_action_done', 'propose_amendment', 'save_document', 'update_lease_terms']);
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, ['list_portfolio', 'get_lease'].includes(t.name), t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
  }
  const props = by.create_lease.inputSchema.properties;
  assert.equal(props.lock_in_months.type, 'integer');
  assert.equal(props.notice_months.type, 'integer');
  assert.deepEqual(props.tax_on_charges.enum, ['unknown', 'yes', 'no']);
  assert.deepEqual(props.lock_in_notice_policy.enum, ['not_specified', 'may_serve_during_lock_in', 'must_wait_until_after_lock_in']);
  assert.ok(by.propose_amendment.inputSchema.required.includes('changes'));
  await c.close();
});

test('MCP validation: fractional months, impossible dates and missing evidence are refused', async () => {
  const c = await mcp();
  const frac = await call(c, 'create_lease', { ...INDIRANAGAR_FROM_CLAUDE, lock_in_months: 36.5 });
  assert.equal(frac.isError, true);
  assert.match(frac.text, /lock_in_months|whole months|integer/i);
  const date = await call(c, 'create_lease', { ...INDIRANAGAR_FROM_CLAUDE, expiry_date: '2027-02-31' });
  assert.equal(date.isError, true);
  assert.match(date.text, /calendar date/);
  const noEv = await call(c, 'create_lease', { ...INDIRANAGAR_FROM_CLAUDE, evidence: [] });
  assert.equal(noEv.isError, true);
  assert.match(noEv.text, /evidence/);
  const p = await call(c, 'list_portfolio', {});
  assert.equal(p.json.counts.leases, 2, 'nothing was written by the refused calls');
  await c.close();
});

test('A request in Claude creates a real lease (Needs review), with computed dates', async () => {
  const c = await mcp();
  const before = await call(c, 'list_portfolio', {});
  assert.equal(before.json.counts.leases, 2, 'two sample leases seeded');
  const r = await call(c, 'create_lease', INDIRANAGAR_FROM_CLAUDE);
  assert.equal(r.isError, false, r.text);
  assert.equal(r.json.status, 'needs_review');
  assert.match(r.json.app_url, /\/app\/l\/\d+$/);
  assert.ok(r.json.review.unverified_required_terms.includes('monthly_rent'));
  assert.ok(r.json.critical_dates.some((d) => d.label === 'Last day to exercise the renewal option' && d.date === '2026-12-30'));
  assert.ok(r.json.critical_dates.some((d) => d.label === 'Last day of lock-in' && d.date === '2021-06-30'));
  assert.equal(r.json.lock_in.earliest_exit_last_day, '2021-09-30');
  assert.ok(r.json.needs_attention.some((m) => /lock-in/.test(m)), 'Claude\'s ambiguity flag is passed back');
  S.leaseId = r.json.lease_id;
  const again = await call(c, 'create_lease', INDIRANAGAR_FROM_CLAUDE);
  assert.equal(again.isError, true);
  assert.match(again.text, /already exists/);
  const bad = await call(c, 'create_lease', { location: { name: 'X' }, start_date: '2025-01-01', expiry_date: '2024-01-01' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /Expiry date must be after/);
  await c.close();
});

test('A person opens the app, sees Claude\'s lease and evidence, cannot approve until verified', async () => {
  S.cookie = await login();
  const page = await (await fetch(`${BASE}/app/l/${S.leaseId}`, { headers: { Cookie: S.cookie } })).text();
  assert.match(page, /Indiranagar cafe: leave and license/);
  assert.match(page, /Added by Claude/);
  assert.match(page, /on the last paid license fee at the end of every thirty-six/);
  assert.match(page, /Needs interpretation/);
  assert.match(page, /Claude flagged/);
  const early = await api(S.cookie, 'POST', `/api/leases/${S.leaseId}/approve`, {});
  assert.equal(early.status, 400);
  assert.match((await early.json()).error, /Verify these terms first/);
});

test('The person corrects a wrong term, verifies the rest and approves; numbers recalculate', async () => {
  const fix = await api(S.cookie, 'PATCH', `/api/leases/${S.leaseId}`, { escalation_percent: '15', reason: 'Clause 4.1 says fifteen percent' });
  assert.equal(fix.status, 200);
  const bulk = await (await api(S.cookie, 'POST', `/api/leases/${S.leaseId}/verify-quoted`, {})).json();
  assert.ok(bulk.verified.includes('monthly_rent'));
  assert.deepEqual(bulk.still_to_review, ['lock_in_notice_policy'], 'the term Claude flagged must be decided on its own');
  assert.equal((await api(S.cookie, 'POST', `/api/leases/${S.leaseId}/approve`, {})).status, 400);
  for (const field of bulk.still_to_review) {
    assert.equal((await api(S.cookie, 'POST', `/api/leases/${S.leaseId}/verify`, { field })).status, 200);
  }
  assert.equal((await api(S.cookie, 'POST', `/api/leases/${S.leaseId}/approve`, {})).status, 200);
  const d = await (await api(S.cookie, 'GET', `/api/leases/${S.leaseId}`)).json();
  assert.equal(d.status, 'approved');
  assert.equal(d.terms.find((t) => t.key === 'escalation_percent').evidence.corrected, true);
  assert.equal(d.schedule.at(-1).rent, 238050, 'rent recalculated from the corrected 15%');
  assert.equal(d.schedule[0].total, 247800);
  const audit = d.activity.find((a) => a.field === 'escalation_percent');
  assert.deepEqual([audit.old_value, audit.new_value, audit.source, audit.reason], ['5', '15', 'person', 'Clause 4.1 says fifteen percent']);
  for (const [body, re] of [[{ tax_percent: 140 }, /above 100/], [{ lock_in_months: 36.5 }, /whole number/], [{ expiry_date: '2027-04-31' }, /calendar date/], [{ monthly_rent: '1.234' }, /decimal places/]]) {
    const bad = await api(S.cookie, 'PATCH', `/api/leases/${S.leaseId}`, body);
    assert.equal(bad.status, 400, JSON.stringify(body));
    assert.match((await bad.json()).error, re);
  }
});

test('Claude reads the person\'s changes, drafts a letter; the person edits and marks it sent', async () => {
  const c = await mcp();
  const g = await call(c, 'get_lease', { lease_id: S.leaseId });
  assert.equal(g.json.status, 'approved');
  assert.equal(g.json.terms.escalation_percent.value, 15);
  assert.equal(g.json.terms.escalation_percent.corrected_by_person, true);
  assert.equal(g.json.money.rent_now > 0, true);
  const renewal = g.json.critical_dates.find((d) => d.label.startsWith('Last day to exercise the renewal'));
  const p = await call(c, 'list_portfolio', { days_ahead: 90 });
  assert.ok(p.json.actions.some((a) => a.lease_id === S.leaseId && a.action_key === renewal.action_key), 'renewal deadline shows in the 90-day actions');
  const doc = await call(c, 'save_document', { lease_id: S.leaseId, kind: 'letter', title: 'Notice to exercise renewal option <script>alert(1)</script>', body: 'Dear Mr. Gowda,\nWe hereby exercise the option to renew under Clause 9.1 ...' });
  S.docId = doc.json.document_id;
  await c.close();
  assert.equal((await api(S.cookie, 'PATCH', `/api/documents/${S.docId}`, { body: 'Dear Mr. Gowda,\nEdited by finance.', status: 'sent' })).status, 200);
  assert.equal((await api(S.cookie, 'POST', `/api/leases/${S.leaseId}/actions`, { action_key: renewal.action_key, done: true })).status, 200);
  const page = await (await fetch(`${BASE}/app/l/${S.leaseId}`, { headers: { Cookie: S.cookie } })).text();
  assert.match(page, /Edited by finance/);
  assert.match(page, /Drafted by Claude/);
  assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Claude-written text is escaped');
});

test('If Claude changes a key term on an approved lease, it goes back to review', async () => {
  const c = await mcp();
  const u = await call(c, 'update_lease_terms', { lease_id: S.leaseId, monthly_rent: 185000, evidence: [{ field: 'monthly_rent', clause_quote: 'Rs. 1,85,000', clause_ref: 'Clause 3.1' }] });
  assert.match(u.json.message, /sent back for review/);
  const g = await call(c, 'get_lease', { lease_id: S.leaseId });
  assert.equal(g.json.status, 'needs_review');
  assert.equal(g.json.terms.monthly_rent.verified, false);
  await c.close();
  // the person restores the right figure, which also verifies it, then re-approves
  assert.equal((await api(S.cookie, 'PATCH', `/api/leases/${S.leaseId}`, { monthly_rent: 180000 })).status, 200);
  assert.equal((await api(S.cookie, 'POST', `/api/leases/${S.leaseId}/approve`, {})).status, 200);
});

test('Amendment: Claude proposes, the person accepts one change and rejects another, numbers recalculate', async () => {
  const c = await mcp();
  const p = await call(c, 'propose_amendment', {
    lease_id: S.leaseId, title: 'Addendum 1 dated 2026-10-01', effective_date: '2026-10-01',
    changes: [
      { field: 'cam_monthly', new_value: 32000, clause_quote: 'the maintenance charges shall be Rs. 32,000/- per month', clause_ref: 'Clause 2' },
      { field: 'renewal_notice_months', new_value: 9, clause_quote: 'not less than nine (9) months before the expiry', clause_ref: 'Clause 3' },
    ],
  });
  assert.equal(p.isError, false, p.text);
  const g = await call(c, 'get_lease', { lease_id: S.leaseId });
  assert.equal(g.json.terms.cam_monthly.value, 30000, 'unchanged until a person accepts');
  assert.equal(g.json.pending_amendment_changes.length, 2);
  const page = await (await fetch(`${BASE}/app/l/${S.leaseId}`, { headers: { Cookie: S.cookie } })).text();
  assert.match(page, /Amendment waiting for your decision/);
  const d = await (await api(S.cookie, 'GET', `/api/leases/${S.leaseId}`)).json();
  const cam = d.amendments[0].changes.find((x) => x.field === 'cam_monthly');
  assert.equal((await api(S.cookie, 'POST', `/api/amendments/${p.json.amendment_id}/decide`, { decision: 'accept', change_id: cam.id })).status, 200);
  assert.equal((await api(S.cookie, 'POST', `/api/amendments/${p.json.amendment_id}/decide`, { decision: 'reject' })).status, 200);
  const g2 = await call(c, 'get_lease', { lease_id: S.leaseId });
  assert.equal(g2.json.terms.cam_monthly.value, 32000);
  assert.equal(g2.json.terms.renewal_notice_months.value, 6);
  assert.equal(g2.json.status, 'approved');
  await c.close();
  const after = await (await api(S.cookie, 'GET', `/api/leases/${S.leaseId}`)).json();
  assert.equal(after.schedule[0].total, 250160); // (180000 + 32000) * 1.18
  assert.ok(after.activity.some((a) => a.field === 'cam_monthly' && a.old_value === '30000' && a.new_value === '32000' && a.source === 'amendment'));
});

test('Security: bad MCP key, no session, bad payloads, cross-site writes, other companies', async () => {
  const bad = await fetch(`${BASE}/mcp/nope`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(bad.status, 404);
  assert.equal((await fetch(MCP_URL)).status, 405);
  assert.equal((await fetch(`${BASE}/api/leases/${S.leaseId}`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/leases/${S.leaseId}`, { headers: { Cookie: 'li_session=forged-token' } })).status, 401);
  assert.equal((await fetch(`${BASE}/api/leases`, { method: 'POST', headers: { Cookie: S.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=1' })).status, 415);
  const badJson = await fetch(`${BASE}/api/leases`, { method: 'POST', headers: { Cookie: S.cookie, 'Content-Type': 'application/json' }, body: '{"oops"' });
  assert.equal(badJson.status, 400);
  const huge = await fetch(`${BASE}/api/leases`, { method: 'POST', headers: { Cookie: S.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'x'.repeat(1_100_000) }) });
  assert.equal(huge.status, 413);
  const cross = await fetch(`${BASE}/api/leases/${S.leaseId}/approve`, { method: 'POST', headers: { Cookie: S.cookie, 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(cross.status, 403);
  const crossForm = await fetch(`${BASE}/logout`, { method: 'POST', redirect: 'manual', headers: { Cookie: S.cookie, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossForm.status, 403);
  assert.equal((await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp/li_demo_volopay_2026`)).status, 404);
  const s = await fetch(`${BASE}/signup`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ company: 'Other Co', name: 'Asha', email: 'asha@other.example', password: 'password123' }) });
  const cookieHeader = s.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Lax/);
  const other = cookieHeader.split(';')[0];
  assert.equal((await api(other, 'GET', `/api/leases/${S.leaseId}`)).status, 404);
  assert.equal((await api(other, 'POST', `/api/leases/${S.leaseId}/approve`, {})).status, 404);
  assert.equal((await api(other, 'PATCH', `/api/documents/${S.docId}`, { body: 'hijack' })).status, 404);
  assert.equal((await api(other, 'POST', '/api/settings/reset-demo', {})).status, 403);
  const p = await (await api(other, 'GET', '/api/portfolio')).json();
  assert.equal(p.leases.length, 0);
  const page = await (await fetch(`${BASE}/app/l/${S.leaseId}`, { headers: { Cookie: S.cookie } })).text();
  assert.ok(!page.includes('<script>alert'), 'no unescaped user content');
});

test('Data survives a full restart; CSV export and sample PDFs work', async () => {
  await stop();
  await start();
  const c = await mcp();
  const g = await call(c, 'get_lease', { lease_id: S.leaseId });
  assert.equal(g.json.status, 'approved');
  assert.equal(g.json.documents[0].status, 'sent');
  await c.close();
  const cookie = await login();
  const csv = await (await fetch(`${BASE}/app/l/${S.leaseId}/schedule.csv`, { headers: { Cookie: cookie } })).text();
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 109); // header + 108 months
  assert.match(lines[0], /GST/);
  assert.equal(lines[1], '1,2018-07-01,180000,32000,38160,0,250160');
  const pdf = await fetch(`${BASE}/samples/indiranagar-cafe-lease.pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
});

test('Logout ends the session; signup is rate limited', async () => {
  const cookie = await login();
  assert.equal((await fetch(`${BASE}/logout`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie } })).status, 302);
  assert.equal((await api(cookie, 'GET', '/api/portfolio')).status, 401);
  let last;
  for (let i = 0; i < 5; i++) {
    last = await fetch(`${BASE}/signup`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ company: 'C', name: 'N', email: `n${i}@rate.example`, password: 'password123' }) });
  }
  assert.equal(last.status, 429);
});

test('Production without DATABASE_URL refuses to start (no silent in-memory database)', async () => {
  const p = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: '4599', NODE_ENV: 'production', DATABASE_URL: '', POSTGRES_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((r) => p.once('exit', r));
  assert.notEqual(code, 0);
  assert.match(err, /DATABASE_URL is not set/);
});

test('Demo reset restores the two sample leases', async () => {
  const cookie = await login();
  assert.equal((await api(cookie, 'POST', '/api/settings/reset-demo', {})).status, 200);
  const p = await (await api(cookie, 'GET', '/api/portfolio')).json();
  assert.equal(p.leases.length, 2);
});
