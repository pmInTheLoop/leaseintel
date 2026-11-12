// Regression tests on the three real sample PDFs. The reference extraction in test/fixtures/samples.js is written by
// hand from the PDF text. These tests check (1) every quoted clause really is in the PDF, word for word, and
// (2) saving that extraction produces the expected dates, amounts and warnings. They do not prove that Claude will
// extract these values; that is checked live, and a person verifies every term before approval.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL } from './fixtures/samples.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaseintel-samples-'));
process.env.PGLITE_DIR = dir;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getDb } = await import('../src/db.js');
const L = await import('../src/logic.js');

let db; let ws;
before(async () => {
  db = await getDb();
  ws = (await db.query("INSERT INTO workspaces (name, mcp_key) VALUES ('samples', $1) RETURNING id", [`li_samples_${Date.now()}`]))[0].id;
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// pdftotext drops the "-" of the Indian amount suffix "/-" when it ends a line, so "/-" and "/" compare equal.
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\/-/g, '/').replace(/\s+/g, ' ').trim();
let hasPdftotext = true;
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { hasPdftotext = false; }

for (const sample of ALL) {
  test(`${sample.file}: every quoted clause appears verbatim in the PDF`, { skip: !hasPdftotext && 'pdftotext not installed' }, () => {
    const pdfText = norm(execFileSync('pdftotext', [path.join('samples', sample.file), '-']).toString());
    const quotes = [...sample.payload.evidence.map((e) => e.clause_quote), ...sample.payload.other_clauses.map((c) => c.clause_quote)];
    for (const q of quotes) assert.ok(pdfText.includes(norm(q)), `not found in ${sample.file}: "${q}"`);
  });

  test(`${sample.file}: saved extraction gives the expected dates, amounts and warnings`, async () => {
    const id = await L.createLease(db, ws, JSON.parse(JSON.stringify(sample.payload)), 'claude');
    const d = await L.getLease(db, ws, id, '2026-11-11');
    const E = sample.expect;
    assert.equal(d.schedule.length, E.months);
    for (const [k, v] of Object.entries(E.first_month)) assert.equal(d.schedule[0][k], v, `first month ${k}`);
    if (E.last_month) for (const [k, v] of Object.entries(E.last_month)) assert.equal(d.schedule.at(-1)[k], v, `last month ${k}`);
    for (const [type, date] of Object.entries(E.dates)) assert.equal(d.dates.find((x) => x.type === type)?.date, date, type);
    if (E.escalations) assert.deepEqual(d.dates.filter((x) => x.type === 'escalation').map((x) => x.date), E.escalations);
    if (E.escalation_rents) {
      const { escalationSteps } = await import('../src/engine.js');
      assert.deepEqual(escalationSteps(d.lease).map((s) => s.monthly_rent), E.escalation_rents);
    }
    if (E.no_renewal_date) assert.ok(!d.dates.some((x) => x.type === 'renewal_notice'));
    if (E.earliest_exit_last_day) assert.equal(d.lock_in.earliest_exit_last_day, E.earliest_exit_last_day);
    assert.deepEqual(d.warnings.map((w) => w.code), E.warnings);
    assert.ok(!d.dates.some((x) => x.type === 'expiry_notice'), 'no invented notice-to-vacate deadline');
    assert.equal(d.status, 'needs_review');
    assert.equal(d.review.can_approve, false, 'a person must verify before approval');
  });
}
