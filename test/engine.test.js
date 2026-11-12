// Unit tests for the lease engine: every date and amount LeaseIntel shows comes from these functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isYmd, addMonths, addDays, escalationSteps, rentSchedule, yearlySummary, criticalDates, commitments, displayStatus,
  lockIn, leaseWarnings, taxScope, addAmounts,
} from '../src/engine.js';
import { toUnits, unitsToString, divRound, minorDigits, canonical } from '../src/money.js';

const INDIRANAGAR = {
  start_date: '2018-07-01', expiry_date: '2027-06-30', monthly_rent: 180000, currency: 'INR', lock_in_months: 36, notice_months: 3,
  lock_in_notice_policy: 'must_wait_until_after_lock_in',
  escalation_percent: 15, escalation_every_months: 36, escalation_basis: 'compound', renewal_term_months: 60, renewal_notice_months: 6,
  cam_monthly: 30000, tax_name: 'GST', tax_percent: 18, tax_on_rent: 'yes', tax_on_charges: 'yes',
};
const dateOf = (lease, type) => criticalDates(lease).find((x) => x.type === type)?.date;

// ---------- 3.1 strict calendar dates ----------
test('isYmd accepts only real calendar dates', () => {
  for (const ok of ['2024-02-29', '2024-01-31', '2028-02-29', '2027-06-30']) assert.equal(isYmd(ok), true, ok);
  for (const bad of ['2023-02-29', '2024-04-31', '2024-02-31', '2024-13-01', '2024-00-10', '2024-01-00', '2024-1-01', '24-01-01',
    '2024/01/01', '2024-01-01T00:00:00Z', ' 2024-01-01', '', null, undefined, 20240101]) assert.equal(isYmd(bad), false, String(bad));
});

test('addMonths: month-end safe, leap years, negative offsets, whole months only', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(addMonths('2028-02-29', 12), '2029-02-28');
  assert.equal(addMonths('2028-02-29', -3), '2027-11-29');
  assert.equal(addMonths('2027-06-30', -6), '2026-12-30');
  assert.equal(addMonths('2024-03-31', -1), '2024-02-29');
  assert.equal(addMonths('2025-01-15', -13), '2023-12-15');
  assert.equal(addMonths('2018-07-01', 108), '2027-07-01');
  assert.throws(() => addMonths('2024-01-01', 1.5), /whole months/);
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});

// ---------- 3.3 lock-in semantics ----------
test('lock-in: last day and first day after are different dates', () => {
  const L = lockIn(INDIRANAGAR);
  assert.equal(L.last_day, '2021-06-30');
  assert.equal(L.first_day_after, '2021-07-01');
  assert.equal(dateOf(INDIRANAGAR, 'lockin_last_day'), '2021-06-30');
  assert.equal(criticalDates(INDIRANAGAR).find((x) => x.type === 'lockin_last_day').label, 'Last day of lock-in');
});

test('lock-in notice policy drives the exit dates; unclear policy gives a warning, not a deadline', () => {
  const after = lockIn(INDIRANAGAR);
  assert.equal(after.notice_can_be_served_from, '2021-07-01');
  assert.equal(after.earliest_exit_last_day, '2021-09-30');
  assert.equal(after.last_day_to_serve_notice, null);
  assert.equal(dateOf(INDIRANAGAR, 'lockin_exit_notice'), undefined);

  const during = { ...INDIRANAGAR, lock_in_notice_policy: 'may_serve_during_lock_in' };
  assert.equal(lockIn(during).last_day_to_serve_notice, '2021-03-30'); // 3 months before 30 Jun 2021 (conservative)
  assert.equal(lockIn(during).earliest_exit_last_day, '2021-06-30');
  assert.equal(dateOf(during, 'lockin_exit_notice'), '2021-03-30');

  const unclear = { ...INDIRANAGAR, lock_in_notice_policy: 'not_specified' };
  assert.equal(lockIn(unclear).interpretation_needed, true);
  assert.equal(dateOf(unclear, 'lockin_exit_notice'), undefined);
  assert.equal(dateOf(unclear, 'exit_notice_window_opens'), undefined);
  assert.deepEqual(leaseWarnings(unclear).map((w) => w.code), ['lock_in_notice_policy']);
});

test('no lock-in: no lock-in dates, no warning', () => {
  const free = { ...INDIRANAGAR, lock_in_months: 0, lock_in_notice_policy: 'not_specified' };
  assert.equal(lockIn(free), null);
  assert.ok(!criticalDates(free).some((x) => x.type.startsWith('lockin') || x.type === 'exit_notice_window_opens'));
  assert.deepEqual(leaseWarnings(free), []);
});

test('no invented "notice to vacate at expiry" deadline', () => {
  assert.ok(!criticalDates(INDIRANAGAR).some((x) => x.type === 'expiry_notice'));
});

// ---------- escalations ----------
test('compound escalation: 15% on last paid rent every 36 months', () => {
  assert.deepEqual(escalationSteps(INDIRANAGAR), [
    { step: 1, date: '2021-07-01', monthly_rent: 207000 },
    { step: 2, date: '2024-07-01', monthly_rent: 238050 },
  ]);
});

test('simple escalation on original base rent differs from compounding', () => {
  const steps = escalationSteps({ ...INDIRANAGAR, escalation_basis: 'base' });
  assert.equal(steps[1].monthly_rent, 234000); // 180000 * (1 + 0.15 * 2)
});

test('escalation from an explicit first date, compounding rounded to the paisa each step', () => {
  const hsr = { start_date: '2025-02-01', expiry_date: '2030-01-31', monthly_rent: 95000, currency: 'INR', escalation_percent: 5,
    escalation_every_months: 12, escalation_basis: 'compound', first_escalation_date: '2026-02-01' };
  assert.deepEqual(escalationSteps(hsr).map((s) => [s.date, s.monthly_rent]),
    [['2026-02-01', 99750], ['2027-02-01', 104737.5], ['2028-02-01', 109974.38], ['2029-02-01', 115473.1]]);
  const later = { ...hsr, first_escalation_date: '2026-08-01' };
  assert.equal(escalationSteps(later)[0].date, '2026-08-01');
  assert.equal(escalationSteps(later)[1].date, '2027-08-01');
});

test('no escalation when percent is 0 or interval is 0', () => {
  assert.deepEqual(escalationSteps({ ...INDIRANAGAR, escalation_percent: 0 }), []);
  assert.deepEqual(escalationSteps({ ...INDIRANAGAR, escalation_every_months: 0 }), []);
  assert.ok(!criticalDates({ ...INDIRANAGAR, escalation_percent: 0 }).some((x) => x.type === 'escalation'));
});

// ---------- 3.4 tax scope ----------
test('tax on rent and charges (Indiranagar cl. 3.3)', () => {
  const s = rentSchedule(INDIRANAGAR);
  assert.equal(s.length, 108);
  assert.deepEqual(s[0], { month: 1, period_start: '2018-07-01', rent: 180000, cam: 30000, tax: 37800, tax_unresolved_on: 0, total: 247800 });
  assert.equal(s[36].rent, 207000);
  assert.equal(s[107].total, 316299);
  const y = yearlySummary(INDIRANAGAR);
  assert.equal(y.length, 9);
  assert.equal(y[0].total, 2973600);
});

test('tax on rent only, charges not taxed', () => {
  const s = rentSchedule({ ...INDIRANAGAR, tax_on_charges: 'no' });
  assert.deepEqual(s[0], { month: 1, period_start: '2018-07-01', rent: 180000, cam: 30000, tax: 32400, tax_unresolved_on: 0, total: 242400 });
});

test('unknown tax scope is reported, never charged, and flagged', () => {
  const dubai = { start_date: '2026-03-01', expiry_date: '2028-02-29', monthly_rent: 14500, currency: 'AED', cam_monthly: 1200,
    tax_name: 'VAT', tax_percent: 5, tax_on_rent: 'yes', tax_on_charges: 'unknown' };
  const s = rentSchedule(dubai);
  assert.equal(s.length, 24);
  assert.deepEqual(s[0], { month: 1, period_start: '2026-03-01', rent: 14500, cam: 1200, tax: 725, tax_unresolved_on: 1200, total: 16425 });
  assert.deepEqual(leaseWarnings(dubai).map((w) => w.code), ['tax_on_charges']);
  assert.equal(commitments(dubai, '2026-11-11').totals_final, false);
  assert.equal(taxScope(dubai).name, 'VAT');
  const rentUnknown = { ...dubai, tax_on_rent: 'unknown' };
  assert.equal(rentSchedule(rentUnknown)[0].tax, 0);
  assert.equal(rentSchedule(rentUnknown)[0].tax_unresolved_on, 15700);
  assert.deepEqual(leaseWarnings(rentUnknown).map((w) => w.code), ['tax_on_rent', 'tax_on_charges']);
});

test('no tax rate means no tax and no warning; generic label', () => {
  const plain = { ...INDIRANAGAR, tax_percent: null, tax_on_rent: 'unknown', tax_on_charges: 'unknown', tax_name: '' };
  assert.equal(rentSchedule(plain)[0].tax, 0);
  assert.equal(rentSchedule(plain)[0].total, 210000);
  assert.deepEqual(leaseWarnings(plain), []);
  assert.equal(taxScope(plain).name, 'Tax');
});

// ---------- 4.2 exact money ----------
test('money helpers: exact parsing, half-up rounding, currency decimals', () => {
  assert.equal(toUnits('180000.0000', 4), 1800000000n);
  assert.equal(toUnits(0.1, 2) + toUnits(0.2, 2), toUnits(0.3, 2)); // no float drift
  assert.equal(unitsToString(10473750n, 2), '104737.5');
  assert.equal(divRound(5n, 2n), 3n);
  assert.equal(divRound(4n, 2n), 2n);
  assert.throws(() => toUnits('1.234', 2), /decimal places/);
  assert.throws(() => toUnits('-1', 2));
  assert.throws(() => toUnits(1e21, 2));
  assert.equal(minorDigits('INR'), 2);
  assert.equal(minorDigits('AED'), 2);
  assert.equal(minorDigits('JPY'), 0);
  assert.equal(canonical('7.5000'), '7.5');
  assert.equal(addAmounts([0.1, 0.2, 316299], 'INR'), 316299.3);
});

test('zero-decimal currency rounds to whole units; two-decimal currency to cents', () => {
  const jpy = { start_date: '2025-01-01', expiry_date: '2027-12-31', monthly_rent: 100001, currency: 'JPY', escalation_percent: 3.3,
    escalation_every_months: 12, escalation_basis: 'compound', tax_percent: 10, tax_on_rent: 'yes' };
  const s = rentSchedule(jpy);
  assert.equal(s[12].rent, 103301); // 100001 * 1.033 = 103301.033 → 103301
  assert.equal(s[0].tax, 10000); // 10000.1 → 10000
  const sgd = { ...jpy, currency: 'SGD', monthly_rent: 1000.05 };
  assert.equal(rentSchedule(sgd)[12].rent, 1033.05); // 1033.05165 → 1033.05
  assert.equal(rentSchedule(sgd)[0].tax, 100.01); // 100.005 → 100.01 (half up)
});

// ---------- dates and commitments ----------
test('renewal date only when there is a renewal option', () => {
  assert.equal(dateOf(INDIRANAGAR, 'renewal_notice'), '2026-12-30');
  assert.ok(!criticalDates({ ...INDIRANAGAR, renewal_term_months: 0 }).some((x) => x.type === 'renewal_notice'));
});

test('commitments: current, future and expired leases', () => {
  const c = commitments(INDIRANAGAR, '2026-11-11');
  assert.equal(c.rent_now, 238050);
  assert.equal(c.monthly_outflow_now, 316299);
  assert.equal(c.remaining_months, 8); // Nov 2026 to Jun 2027
  assert.equal(c.remaining_total, 316299 * 8);
  assert.equal(c.committed_until_lock_in_end, 0);
  assert.equal(c.totals_final, true);

  const fresh = { ...INDIRANAGAR, start_date: '2026-01-01', expiry_date: '2030-12-31' };
  const f = commitments(fresh, '2026-11-11');
  assert.equal(f.lock_in_last_day, '2028-12-31');
  assert.equal(f.committed_until_lock_in_end, 247800 * 26); // Nov 2026 .. Dec 2028, exact

  const future = commitments({ ...INDIRANAGAR, start_date: '2027-01-01', expiry_date: '2030-12-31' }, '2026-11-11');
  assert.equal(future.not_started, true);
  assert.equal(future.rent_now, 0);
  assert.equal(future.remaining_months, 48);

  const ended = commitments(INDIRANAGAR, '2027-07-01');
  assert.equal(ended.ended, true);
  assert.equal(ended.remaining_total, 0);
  assert.equal(ended.monthly_outflow_now, 0);
  assert.equal(displayStatus({ ...INDIRANAGAR, status: 'approved' }, '2027-07-01'), 'expired');
  assert.equal(displayStatus({ ...INDIRANAGAR, status: 'needs_review' }, '2026-11-11'), 'needs_review');
});

test('changing one term updates every dependent calculation', () => {
  const before = { dates: criticalDates(INDIRANAGAR), sched: rentSchedule(INDIRANAGAR), money: commitments(INDIRANAGAR, '2026-11-11') };
  const changed = { ...INDIRANAGAR, start_date: '2018-08-01', expiry_date: '2027-07-31' };
  assert.equal(dateOf(changed, 'lockin_last_day'), '2021-07-31');
  assert.equal(dateOf(changed, 'renewal_notice'), '2027-01-31');
  assert.notDeepEqual(criticalDates(changed).map((d) => d.key), before.dates.map((d) => d.key)); // keys move with dates
  const rent = { ...INDIRANAGAR, monthly_rent: 185000 };
  assert.equal(rentSchedule(rent)[0].total, 253700); // (185000 + 30000) * 1.18
  assert.equal(escalationSteps(rent)[1].monthly_rent, 244662.5);
  assert.notEqual(commitments(rent, '2026-11-11').remaining_total, before.money.remaining_total);
});

test('invalid or missing dates produce no schedule instead of wrong numbers', () => {
  assert.deepEqual(rentSchedule({ ...INDIRANAGAR, expiry_date: '2017-01-01' }), []);
  assert.deepEqual(criticalDates({ ...INDIRANAGAR, start_date: null }), []);
  assert.deepEqual(rentSchedule({ ...INDIRANAGAR, start_date: '2023-02-29' }), []);
  assert.equal(commitments({ ...INDIRANAGAR, start_date: null }), null);
});

test('multiple currencies are never added together', () => {
  assert.equal(addAmounts([14500, 1200.5], 'AED'), 15700.5);
  assert.throws(() => addAmounts([1.234], 'INR'));
});
