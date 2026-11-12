// The lease engine: plain date and money arithmetic, no AI.
// Every critical date and every amount in the rent schedule is computed here from the lease terms.
// Money is exact decimal arithmetic (src/money.js); dates are calendar arithmetic in UTC.
import { toUnits, rescale, divRound, unitsToNumber, minorDigits, PCT_SCALE, PCT_DENOM } from './money.js';

// ---------- dates (YYYY-MM-DD strings) ----------
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** Strict calendar date: the year, month and day must exist (2024-02-29 yes, 2023-02-29 no). */
export function isYmd(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

function parts(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

/** Add whole months (negative allowed). Month-end safe: 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(ymd, n) {
  if (!Number.isInteger(n)) throw new RangeError(`addMonths needs whole months, got ${n}`);
  const { y, m, d } = parts(ymd);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}
export function addDays(ymd, n) {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(toYmd + 'T00:00:00Z') - Date.parse(fromYmd + 'T00:00:00Z')) / 86400000);
}
/** Today in India (UTC+5:30), the default business calendar. */
export function todayIST(now = new Date()) {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

export const fmtMoney = (n, cur = 'INR') => {
  try { return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: minorDigits(cur) }).format(n); }
  catch { return `${cur} ${n}`; }
};
const fmtDay = (ymd) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---------- reading terms ----------
const blank = (v) => v === null || v === undefined || v === '';
/** Whole months as a JS integer (validated upstream; anything else counts as 0 here). */
const nMonths = (n) => `${n} month${Number(n) === 1 ? '' : 's'}`;
const months = (v) => {
  if (blank(v)) return 0;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const cur = (lease) => lease.currency || 'INR';
/** Money in the currency's minor units (e.g. paise), as BigInt. */
const amount = (v, digits) => (blank(v) ? 0n : rescale(toUnits(v, 4), 4, digits));
const pct = (v) => (blank(v) ? 0n : toUnits(v, PCT_SCALE));

export function hasCoreDates(lease) {
  return isYmd(lease.start_date) && isYmd(lease.expiry_date) && lease.expiry_date > lease.start_date;
}

// ---------- rent ----------
function escalationStepsUnits(lease) {
  if (!hasCoreDates(lease)) return [];
  const d = minorDigits(cur(lease));
  const p = pct(lease.escalation_percent);
  const every = months(lease.escalation_every_months);
  const base = amount(lease.monthly_rent, d);
  if (p <= 0n || every <= 0 || base <= 0n) return [];
  const first = isYmd(lease.first_escalation_date) ? lease.first_escalation_date : addMonths(lease.start_date, every);
  const steps = [];
  let last = base;
  for (let k = 1; k <= 200; k++) {
    const date = k === 1 ? first : addMonths(first, every * (k - 1));
    if (date >= lease.expiry_date) break;
    // compound: each increase applies to the last paid rent, rounded to the currency's smallest unit.
    // base: each increase is the same percentage of the original rent.
    last = lease.escalation_basis === 'base'
      ? divRound(base * (PCT_DENOM + p * BigInt(k)), PCT_DENOM)
      : divRound(last * (PCT_DENOM + p), PCT_DENOM);
    steps.push({ step: k, date, rent: last });
  }
  return steps;
}

/** Rent steps: each escalation date and the monthly rent from that date. */
export function escalationSteps(lease) {
  const d = minorDigits(cur(lease));
  return escalationStepsUnits(lease).map((s) => ({ step: s.step, date: s.date, monthly_rent: unitsToNumber(s.rent, d) }));
}

function rentOnUnits(lease, ymd, steps, d) {
  let rent = amount(lease.monthly_rent, d);
  for (const s of steps) if (s.date <= ymd) rent = s.rent;
  return rent;
}
/** Monthly rent payable for a period starting on `ymd`. */
export function rentOn(lease, ymd) {
  const d = minorDigits(cur(lease));
  return unitsToNumber(rentOnUnits(lease, ymd, escalationStepsUnits(lease), d), d);
}

/** How tax applies under this agreement. Unknown stays unknown: that part is reported, not charged. */
export function taxScope(lease) {
  const rate = pct(lease.tax_percent);
  const d = minorDigits(cur(lease));
  const cam = amount(lease.cam_monthly, d);
  const on = (v) => (v === 'yes' ? 'yes' : v === 'no' ? 'no' : 'unknown');
  return {
    name: (lease.tax_name || '').trim() || 'Tax',
    rate_set: rate > 0n,
    on_rent: rate > 0n ? on(lease.tax_on_rent) : 'no',
    on_charges: rate > 0n && cam > 0n ? on(lease.tax_on_charges) : 'no',
  };
}

function scheduleUnits(lease) {
  if (!hasCoreDates(lease)) return [];
  const d = minorDigits(cur(lease));
  const steps = escalationStepsUnits(lease);
  const cam = amount(lease.cam_monthly, d);
  const rate = pct(lease.tax_percent);
  const scope = taxScope(lease);
  const rows = [];
  for (let i = 0; i < 1200; i++) {
    const period = addMonths(lease.start_date, i);
    if (period >= lease.expiry_date) break;
    const rent = rentOnUnits(lease, period, steps, d);
    let taxable = 0n; let unresolved = 0n;
    for (const [part, scopeOf] of [[rent, scope.on_rent], [cam, scope.on_charges]]) {
      if (part <= 0n || rate <= 0n) continue;
      if (scopeOf === 'yes') taxable += part; else if (scopeOf === 'unknown') unresolved += part;
    }
    const tax = divRound(taxable * rate, PCT_DENOM);
    rows.push({ month: i + 1, period_start: period, rent, cam, tax, unresolved, total: rent + cam + tax });
  }
  return rows;
}

/**
 * Month-by-month schedule from start to expiry. Tax is charged only on the parts the agreement says it applies to.
 * `tax_unresolved_on` is the amount whose tax treatment the agreement does not state; `total` excludes any tax on it,
 * so a row with tax_unresolved_on > 0 is not a final payable figure.
 */
export function rentSchedule(lease) {
  const d = minorDigits(cur(lease));
  return scheduleUnits(lease).map((r) => ({
    month: r.month, period_start: r.period_start, rent: unitsToNumber(r.rent, d), cam: unitsToNumber(r.cam, d),
    tax: unitsToNumber(r.tax, d), tax_unresolved_on: unitsToNumber(r.unresolved, d), total: unitsToNumber(r.total, d),
  }));
}

/** One row per lease year, for the screen. */
export function yearlySummary(lease) {
  const d = minorDigits(cur(lease));
  const years = [];
  for (const r of scheduleUnits(lease)) {
    const y = Math.floor((r.month - 1) / 12);
    if (!years[y]) years[y] = { year: y + 1, from: r.period_start, to: r.period_start, months: 0, rent_from: r.rent, rent_to: r.rent, total: 0n, unresolved: 0n };
    const Y = years[y];
    Y.to = r.period_start; Y.months += 1; Y.rent_to = r.rent; Y.total += r.total; Y.unresolved += r.unresolved;
  }
  return years.map((Y) => ({
    year: Y.year, from: Y.from, to: Y.to, months: Y.months,
    monthly_rent_from: unitsToNumber(Y.rent_from, d), monthly_rent_to: unitsToNumber(Y.rent_to, d),
    total: unitsToNumber(Y.total, d), tax_unresolved_on: unitsToNumber(Y.unresolved, d),
  }));
}

// ---------- lock-in and exit ----------
/**
 * Lock-in facts. For a lease starting 2018-07-01 with a 36-month lock-in, the last day of lock-in is 2021-06-30
 * and the first day outside it is 2021-07-01. Whether exit notice may be served during the lock-in is a contractual
 * question; LeaseIntel only computes an exit deadline when the agreement's policy has been recorded.
 */
export function lockIn(lease) {
  const n = months(lease.lock_in_months);
  if (!hasCoreDates(lease) || n <= 0) return null;
  const firstAfter = addMonths(lease.start_date, n);
  const lastDay = addDays(firstAfter, -1);
  const notice = months(lease.notice_months);
  const policy = lease.lock_in_notice_policy || 'not_specified';
  const out = {
    starts: lease.start_date, last_day: lastDay, first_day_after: firstAfter, notice_months: notice, notice_policy: policy,
    ends_before_expiry: firstAfter <= lease.expiry_date,
    last_day_to_serve_notice: null, notice_can_be_served_from: null, earliest_exit_last_day: null, interpretation_needed: false,
  };
  if (notice > 0) {
    if (policy === 'may_serve_during_lock_in') {
      out.last_day_to_serve_notice = addMonths(lastDay, -notice); // conservative: counted back from the last day
      out.earliest_exit_last_day = lastDay;
    } else if (policy === 'must_wait_until_after_lock_in') {
      out.notice_can_be_served_from = firstAfter;
      out.earliest_exit_last_day = addDays(addMonths(firstAfter, notice), -1);
    } else {
      out.interpretation_needed = true;
    }
  }
  return out;
}

/** Things a person must resolve: the engine refuses to guess these. */
export function leaseWarnings(lease) {
  const w = [];
  const L = lockIn(lease);
  if (L && L.interpretation_needed && L.ends_before_expiry) {
    w.push({ code: 'lock_in_notice_policy', field: 'lock_in_notice_policy',
      message: `The agreement has a ${months(lease.lock_in_months)}-month lock-in and ${nMonths(L.notice_months)} exit notice, but it is not recorded whether notice may be served during the lock-in. No exit deadline is shown until a person sets this from the agreement.` });
  }
  const s = taxScope(lease);
  if (s.rate_set && s.on_rent === 'unknown' && amount(lease.monthly_rent, 2) > 0n) {
    w.push({ code: 'tax_on_rent', field: 'tax_on_rent', message: `${s.name} rate is set, but it is not recorded whether it applies to rent. Totals exclude it until a person sets this.` });
  }
  if (s.on_charges === 'unknown') {
    w.push({ code: 'tax_on_charges', field: 'tax_on_charges', message: `The agreement does not say whether ${s.name} applies to the CAM / service charges. Totals exclude tax on those charges and are not final.` });
  }
  return w;
}

/** The dates a person must act on, computed from the terms. Each key includes its date, so a "done" mark never
 *  carries over to a different date after the terms are corrected. Deadlines use the conservative reading:
 *  "N months before" is counted back from the last day of the period. */
export function criticalDates(lease) {
  if (!hasCoreDates(lease)) return [];
  const out = [];
  const add = (type, date, label, detail, severity) => out.push({ key: `${type}:${date}`, type, date, label, detail, severity });
  const L = lockIn(lease);
  if (L && L.ends_before_expiry) {
    add('lockin_last_day', L.last_day, 'Last day of lock-in', `Lock-in runs from ${fmtDay(L.starts)} to ${fmtDay(L.last_day)} inclusive. Leaving before this day ends can trigger the lock-in terms of the agreement.`, 'info');
    if (L.last_day_to_serve_notice) {
      add('lockin_exit_notice', L.last_day_to_serve_notice, 'Last day to serve exit notice for the earliest exit',
        `The agreement allows notice during lock-in. ${nMonths(L.notice_months)} notice served by this date lets the lease end on ${fmtDay(L.last_day)}, the last day of lock-in.`, 'decision');
    }
    if (L.notice_can_be_served_from) {
      add('exit_notice_window_opens', L.notice_can_be_served_from, 'Exit notice can be served from this day',
        `The agreement allows exit notice only after lock-in. With ${nMonths(L.notice_months)} notice, the earliest the lease can end is ${fmtDay(L.earliest_exit_last_day)}.`, 'info');
    }
  }
  const currency = cur(lease);
  for (const s of escalationSteps(lease)) {
    add('escalation', s.date, `Rent escalation #${s.step}`, `Monthly rent becomes ${fmtMoney(s.monthly_rent, currency)} (before charges and tax). Check the landlord's invoice matches.`, 'money');
  }
  const renewTerm = months(lease.renewal_term_months);
  const renewNotice = months(lease.renewal_notice_months);
  if (renewTerm > 0 && renewNotice > 0) {
    add('renewal_notice', addMonths(lease.expiry_date, -renewNotice), 'Last day to exercise the renewal option',
      `Written notice is required ${nMonths(renewNotice)} before expiry to renew for another ${nMonths(renewTerm)}. The deadline is counted back conservatively from the last day of the lease. Miss it and the option can lapse.`, 'decision');
  }
  add('expiry', lease.expiry_date, 'Lease expires (last day)', renewTerm > 0 ? 'Hand over, or continue under the renewed term if the option was exercised.' : 'The agreement has no renewal option recorded. Hand over or agree a fresh lease.', 'info');
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Money a finance lead asks about: rent now, and what is committed. All sums are exact. */
export function commitments(lease, today = todayIST()) {
  const rows = scheduleUnits(lease);
  if (!rows.length) return null;
  const d = minorDigits(cur(lease));
  const n = (u) => unitsToNumber(u, d);
  const notStarted = today < lease.start_date;
  const ended = today > lease.expiry_date;
  const inTerm = !notStarted && !ended;
  const L = lockIn(lease);
  const currentStart = rows.filter((r) => r.period_start <= today).map((r) => r.period_start).pop() || rows[0].period_start;
  const remaining = ended ? [] : rows.filter((r) => r.period_start >= currentStart);
  const lockRemaining = L && L.first_day_after > today ? remaining.filter((r) => r.period_start < L.first_day_after) : [];
  const sum = (list, k = 'total') => list.reduce((a, r) => a + r[k], 0n);
  const current = inTerm ? rows.find((r) => r.period_start === currentStart) : null;
  return {
    in_term: inTerm,
    not_started: notStarted,
    ended,
    rent_now: current ? n(current.rent) : 0,
    monthly_outflow_now: current ? n(current.total) : 0,
    remaining_months: remaining.length,
    remaining_total: n(sum(remaining)),
    lock_in_last_day: L ? L.last_day : null,
    committed_until_lock_in_end: n(sum(lockRemaining)),
    lease_total: n(sum(rows)),
    tax_unresolved_on_remaining: n(sum(remaining, 'unresolved')),
    totals_final: !rows.some((r) => r.unresolved > 0n),
  };
}

/** Exact per-currency totals across leases (never adds different currencies together). */
export function addAmounts(values, currency) {
  const d = minorDigits(currency);
  return unitsToNumber(values.reduce((a, v) => a + rescale(toUnits(v, d), d, d), 0n), d);
}

/** Status shown to people: approval state plus whether the lease has ended. */
export function displayStatus(lease, today = todayIST()) {
  if (lease.status === 'archived') return 'archived';
  if (isYmd(lease.expiry_date) && lease.expiry_date < today) return 'expired';
  return lease.status; // needs_review | approved
}
