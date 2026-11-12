// Business logic shared by the web app and the MCP server. Deterministic: validation, verification, approval rules,
// persistence and an append-only audit trail. No AI. Every multi-step write runs in one database transaction.
import { FIELDS, FIELD_MAP, FIELD_KEYS, requiredKeysFor } from './fields.js';
import {
  isYmd, todayIST, daysBetween, addDays, criticalDates, rentSchedule, yearlySummary, commitments, displayStatus,
  lockIn, leaseWarnings, taxScope, addAmounts,
} from './engine.js';
import { toUnits, canonical } from './money.js';
import { seedDemoLeases } from './db.js';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const toId = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(`${name} must be a positive integer`);
  return n;
};
const text = (v, max, name, required = false) => {
  if (v === undefined || v === null) { if (required) throw new AppError(`${name} is required`); return v === null ? '' : undefined; }
  if (typeof v === 'object') throw new AppError(`${name} must be text`);
  const s = String(v).trim();
  if (required && !s) throw new AppError(`${name} is required`);
  if (s.length > max) throw new AppError(`${name} is too long (max ${max} characters)`);
  return s;
};

// ---------- validation ----------
const NUMERIC_TYPES = new Set(['money', 'percent', 'number']);
const DECIMALS = { money: 2, percent: 4 };

/** Normalise one lease field. Returns undefined when not provided, null to clear. Money and percentages come back as
 *  canonical decimal strings ("180000", "7.5"); months and days as integers. */
export function cleanField(key, value) {
  const f = FIELD_MAP[key];
  if (!f) throw new AppError(`Unknown lease field: ${key}`);
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    if (f.type === 'text') return '';
    if (f.type === 'currency') return 'INR';
    if (f.type === 'enum') return f.options[0];
    return null;
  }
  if (typeof value === 'object') throw new AppError(`${f.label} must be a single value`);
  switch (f.type) {
    case 'text': return text(value, f.max, f.label);
    case 'date': {
      const s = String(value).trim();
      if (!isYmd(s)) throw new AppError(`${f.label} must be a real calendar date in YYYY-MM-DD format (got "${s}")`);
      return s;
    }
    case 'currency': {
      const s = String(value).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(s)) throw new AppError(`${f.label} must be a 3-letter code like INR, SGD, AED, USD`);
      return s;
    }
    case 'enum': {
      const s = String(value).trim().toLowerCase();
      if (!f.options.includes(s)) throw new AppError(`${f.label} must be one of: ${f.options.join(', ')}`);
      return s;
    }
    case 'months': {
      const s = String(value).replace(/[, _]/g, '');
      if (!/^\d+$/.test(s)) throw new AppError(`${f.label} must be a whole number of months (got "${value}")`);
      const n = Number(s);
      if (n > 1200) throw new AppError(`${f.label} looks too large (max 1200 months)`);
      return n;
    }
    default: {
      const s = String(value).replace(/[, _]/g, '');
      if (!/^\d+(\.\d+)?$/.test(s)) throw new AppError(`${f.label} must be a number of 0 or more`);
      if (f.integer) {
        if (!/^\d+$/.test(s)) throw new AppError(`${f.label} must be a whole number`);
        const n = Number(s);
        if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) throw new AppError(`${f.label} must be between ${f.min} and ${f.max}`);
        return n;
      }
      const scale = DECIMALS[f.type] ?? f.decimals ?? 2;
      let units;
      try { units = toUnits(s, scale); } catch { throw new AppError(`${f.label} can have at most ${scale} decimal places`); }
      const c = canonical(s, scale);
      if (f.type === 'percent' && units > 100n * 10n ** BigInt(scale)) throw new AppError(`${f.label} cannot be above 100`);
      if (f.max !== undefined && units > BigInt(f.max) * 10n ** BigInt(scale)) throw new AppError(`${f.label} must be at most ${f.max}`);
      if (f.type === 'money' && units > 10n ** 13n * 10n ** BigInt(scale)) throw new AppError(`${f.label} is too large`);
      return c;
    }
  }
}

export function cleanFields(input) {
  const out = {};
  for (const key of FIELD_KEYS) {
    const v = cleanField(key, input[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Stored values in canonical form, so comparisons and calculations never depend on how a driver formats NUMERIC. */
function normalizeLease(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of FIELDS) if (NUMERIC_TYPES.has(f.type) && !f.integer) out[f.key] = canonical(row[f.key]);
  return out;
}
/** Value as a person or Claude should see it in JSON (numbers as numbers). Conversion happens only at this edge. */
export function publicValue(key, value) {
  const f = FIELD_MAP[key];
  if (value === null || value === undefined) return null;
  return f && NUMERIC_TYPES.has(f.type) && !f.integer ? Number(value) : value;
}
const valueText = (v) => (v === null || v === undefined || v === '' ? null : String(v));

function checkConsistency(lease) {
  if (isYmd(lease.start_date) && isYmd(lease.expiry_date) && lease.expiry_date <= lease.start_date) {
    throw new AppError('Expiry date must be after the start date');
  }
  if (isYmd(lease.first_escalation_date) && isYmd(lease.start_date) && lease.first_escalation_date <= lease.start_date) {
    throw new AppError('First escalation date must be after the start date');
  }
  if (isYmd(lease.first_escalation_date) && isYmd(lease.expiry_date) && lease.first_escalation_date > lease.expiry_date) {
    throw new AppError('First escalation date must be on or before the expiry date');
  }
}

// ---------- activity (append-only: the table has a rule that ignores UPDATE) ----------
export async function logActivity(db, wsId, leaseId, actor, action, detail = '', extra = {}) {
  await db.query(
    'INSERT INTO activity (workspace_id, lease_id, actor, action, detail, field, old_value, new_value, source, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [wsId, leaseId, actor, action, String(detail).slice(0, 500), extra.field ?? null, extra.old_value ?? null, extra.new_value ?? null,
      extra.source ?? sourceOf(actor), String(extra.reason ?? '').slice(0, 1000)]);
}
const sourceOf = (actor) => (actor === 'claude' ? 'claude' : actor === 'app' ? 'app' : 'person');

// ---------- locations ----------
export async function createLocation(db, wsId, input, actor) {
  const name = text(input?.name, 120, 'Location name', true);
  const city = text(input.city, 80, 'City') || '';
  const kind = text(input.kind, 40, 'Kind') || 'store';
  const owner = text(input.owner_name, 120, 'Owner') || '';
  const rows = await db.query('INSERT INTO locations (workspace_id, name, city, kind, owner_name, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [wsId, name, city, kind, owner, actor]);
  return rows[0].id;
}
export async function listLocations(db, wsId) {
  return db.query('SELECT id, name, city, kind, owner_name FROM locations WHERE workspace_id = $1 ORDER BY name, id', [wsId]);
}
async function locationRow(db, wsId, id) {
  const rows = await db.query('SELECT id, name, city, kind, owner_name FROM locations WHERE id = $1 AND workspace_id = $2', [id, wsId]);
  if (!rows.length) throw new AppError(`Location ${id} not found`, 404);
  return rows[0];
}

// ---------- leases ----------
async function leaseRow(db, wsId, id, { lock = false } = {}) {
  const rows = await db.query(`SELECT * FROM leases WHERE id = $1 AND workspace_id = $2${lock ? ' FOR UPDATE' : ''}`, [toId(id, 'lease_id'), wsId]);
  if (!rows.length) throw new AppError(`Lease ${id} not found`, 404);
  return normalizeLease(rows[0]);
}

function cleanEvidence(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new AppError('evidence must be a list');
  if (list.length > 60) throw new AppError('At most 60 evidence entries');
  return list.map((e, i) => {
    if (!e || !FIELD_MAP[e.field]) throw new AppError(`evidence #${i + 1}: unknown field "${e && e.field}"`);
    return {
      field: e.field,
      clause_quote: text(e.clause_quote, 1500, 'clause_quote') || '',
      clause_ref: text(e.clause_ref, 120, 'clause_ref') || '',
      ambiguity: text(e.ambiguity, 500, 'ambiguity') || '',
    };
  });
}
function cleanClauses(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new AppError('other_clauses must be a list');
  if (list.length > 40) throw new AppError('At most 40 other clauses at a time');
  return list.map((c, i) => ({
    label: text(c && c.label, 120, `other_clauses #${i + 1} label`, true),
    summary: text(c.summary, 1000, 'summary') || '',
    clause_quote: text(c.clause_quote, 1500, 'clause_quote') || '',
    clause_ref: text(c.clause_ref, 120, 'clause_ref') || '',
  }));
}

/** Claude must back every key term it sends with a quote, or explain in `ambiguity` why there is none. */
function requireEvidence(fields, evidence) {
  const ev = new Map(evidence.map((e) => [e.field, e]));
  const missing = requiredKeysFor(fields).filter((k) => fields[k] !== undefined && fields[k] !== null && !(ev.get(k)?.clause_quote || ev.get(k)?.ambiguity));
  if (missing.length) {
    throw new AppError(`Add an evidence entry (clause_quote, or ambiguity explaining why there is no clause) for: ${missing.join(', ')}`);
  }
}

/**
 * Create a lease. From Claude: every term starts unverified, with the quoted clause as evidence.
 * From a person typing it in: the typed terms count as verified by that person.
 * Atomic: the location, lease, terms, clauses and activity row are written together or not at all.
 */
export async function createLease(root, wsId, input, actor, { byPerson = false, personName = '' } = {}) {
  if (!input || typeof input !== 'object') throw new AppError('Lease details are required');
  const fields = cleanFields(input);
  checkConsistency(fields);
  const evidence = cleanEvidence(input.evidence);
  const clauses = cleanClauses(input.other_clauses);
  if (!byPerson) requireEvidence(fields, evidence);
  const notes = text(input.notes, 4000, 'notes') || '';
  const locationInput = input.location_id ? null : input.location;
  if (!input.location_id && !(locationInput && locationInput.name)) {
    throw new AppError('Give location_id of an existing location, or location {name, city} to create one');
  }

  return root.tx(async (db) => {
    let locationId; let locName;
    if (input.location_id) {
      locationId = toId(input.location_id, 'location_id');
      locName = (await locationRow(db, wsId, locationId)).name;
    } else {
      locName = text(locationInput.name, 120, 'Location name', true);
    }
    // Duplicate guard: a retried call (or the same PDF sent twice) must not double-count rent.
    if (!input.allow_duplicate && fields.start_date && fields.expiry_date) {
      const dup = await db.query(
        `SELECT l.id FROM leases l LEFT JOIN locations loc ON loc.id = l.location_id
         WHERE l.workspace_id = $1 AND l.status <> 'archived' AND l.start_date = $2 AND l.expiry_date = $3
           AND l.monthly_rent IS NOT DISTINCT FROM $4::numeric AND (l.location_id = $5 OR lower(loc.name) = lower($6)) LIMIT 1`,
        [wsId, fields.start_date, fields.expiry_date, fields.monthly_rent ?? null, locationId ?? null, locName]);
      if (dup.length) {
        throw new AppError(`Lease ${dup[0].id} already exists for ${locName} with the same dates and rent. Use update_lease_terms on it, or pass allow_duplicate: true if this really is a separate agreement.`, 409);
      }
    }
    if (!locationId) locationId = await createLocation(db, wsId, locationInput, actor);
    const title = text(input.title, 200, 'title') || `${locName} lease`;
    const cols = Object.keys(fields);
    const rows = await db.query(
      `INSERT INTO leases (workspace_id, location_id, title, ${cols.join(', ')}${cols.length ? ',' : ''} status, notes, created_by)
       VALUES ($1, $2, $3, ${cols.map((_, i) => '$' + (i + 4)).join(', ')}${cols.length ? ',' : ''} 'needs_review', $${cols.length + 4}, $${cols.length + 5}) RETURNING id`,
      [wsId, locationId, title, ...cols.map((c) => fields[c]), notes, actor]
    );
    const leaseId = rows[0].id;
    const evByField = new Map(evidence.map((e) => [e.field, e]));
    for (const field of new Set([...cols, ...evByField.keys()])) {
      const ev = evByField.get(field) || { clause_quote: '', clause_ref: '', ambiguity: '' };
      await db.query(
        `INSERT INTO lease_terms (lease_id, field, clause_quote, clause_ref, ambiguity, verified, verified_by, verified_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [leaseId, field, ev.clause_quote, ev.clause_ref, ev.ambiguity, byPerson, byPerson ? personName : null,
          byPerson ? new Date().toISOString() : null, byPerson ? 'person' : 'claude']
      );
    }
    for (const c of clauses) {
      await db.query('INSERT INTO other_clauses (lease_id, label, summary, clause_quote, clause_ref, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [leaseId, c.label, c.summary, c.clause_quote, c.clause_ref, actor]);
    }
    const flagged = evidence.filter((e) => e.ambiguity).map((e) => e.field);
    await logActivity(db, wsId, leaseId, actor, 'lease.created',
      `${title}: ${cols.length} terms, ${clauses.length} other clauses${flagged.length ? `; flagged for interpretation: ${flagged.join(', ')}` : ''}`);
    // Test-only hook (off unless LEASEINTEL_TEST_HOOKS=1): fail after every insert to prove the whole create rolls back.
    if (input.__failAfterInsert && process.env.LEASEINTEL_TEST_HOOKS === '1') throw new Error('simulated failure after insert');
    return leaseId;
  });
}

/**
 * Apply field changes to a locked lease row inside a transaction, keeping verification honest and logging
 * old → new for every changed field. mode: 'claude' (unverifies changed terms), 'person' (verifies what they saved),
 * 'amendment' (a person accepted an amendment clause).
 */
async function applyChanges(db, wsId, current, fields, { mode, actor, personName = '', evidence = [], reason = '', clauseFor = null }) {
  const changed = Object.keys(fields).filter((k) => valueText(current[k]) !== valueText(fields[k]));
  const sets = []; const params = [];
  for (const k of Object.keys(fields)) { params.push(fields[k]); sets.push(`${k} = $${params.length}`); }
  if (sets.length) {
    params.push(current.id);
    await db.query(`UPDATE leases SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
  }
  const evByField = new Map(evidence.map((e) => [e.field, e]));
  for (const field of new Set([...Object.keys(fields), ...evByField.keys()])) {
    const ev = evByField.get(field);
    const valueChanged = changed.includes(field);
    if (mode === 'person') {
      await db.query(
        `INSERT INTO lease_terms (lease_id, field, verified, corrected, verified_by, verified_at, source)
         VALUES ($1,$2,true,$3,$4,now(),'person')
         ON CONFLICT (lease_id, field) DO UPDATE SET verified = true,
           corrected = CASE WHEN $3 THEN true ELSE lease_terms.corrected END,
           verified_by = EXCLUDED.verified_by, verified_at = now()`,
        [current.id, field, valueChanged, personName]
      );
    } else if (mode === 'amendment') {
      const c = clauseFor(field);
      await db.query(
        `INSERT INTO lease_terms (lease_id, field, clause_quote, clause_ref, verified, corrected, verified_by, verified_at, source)
         VALUES ($1,$2,$3,$4,true,false,$5,now(),'amendment')
         ON CONFLICT (lease_id, field) DO UPDATE SET clause_quote = EXCLUDED.clause_quote, clause_ref = EXCLUDED.clause_ref,
           ambiguity = '', verified = true, corrected = false, verified_by = EXCLUDED.verified_by, verified_at = now(), source = 'amendment'`,
        [current.id, field, c.clause_quote, c.clause_ref, personName]
      );
    } else {
      // Claude: a changed value loses its verification; a new quote replaces the old one.
      await db.query(
        `INSERT INTO lease_terms (lease_id, field, clause_quote, clause_ref, ambiguity, verified, source)
         VALUES ($1,$2,$3,$4,$5,false,'claude')
         ON CONFLICT (lease_id, field) DO UPDATE SET
           clause_quote = CASE WHEN $6 THEN EXCLUDED.clause_quote ELSE lease_terms.clause_quote END,
           clause_ref = CASE WHEN $6 THEN EXCLUDED.clause_ref ELSE lease_terms.clause_ref END,
           ambiguity = CASE WHEN $6 THEN EXCLUDED.ambiguity ELSE lease_terms.ambiguity END,
           source = CASE WHEN $7 THEN 'claude' ELSE lease_terms.source END,
           verified = CASE WHEN $7 THEN false ELSE lease_terms.verified END,
           corrected = CASE WHEN $7 THEN false ELSE lease_terms.corrected END,
           verified_by = CASE WHEN $7 THEN NULL ELSE lease_terms.verified_by END,
           verified_at = CASE WHEN $7 THEN NULL ELSE lease_terms.verified_at END`,
        [current.id, field, ev ? ev.clause_quote : '', ev ? ev.clause_ref : '', ev ? ev.ambiguity : '', Boolean(ev), valueChanged]
      );
    }
  }
  const source = mode === 'claude' ? 'claude' : mode === 'amendment' ? 'amendment' : 'person';
  for (const k of changed) {
    const ev = evByField.get(k);
    const why = mode === 'claude' && ev ? [ev.clause_ref, ev.clause_quote && `"${ev.clause_quote}"`].filter(Boolean).join(': ') : reason;
    await logActivity(db, wsId, current.id, actor, 'term.changed', FIELD_MAP[k].label,
      { field: k, old_value: valueText(current[k]), new_value: valueText(fields[k]), source, reason: why });
  }
  return changed;
}

/** After any change: an approved lease that no longer has every required term verified goes back to review. */
async function reopenIfNeeded(db, wsId, leaseId, actor, why) {
  const lease = await leaseRow(db, wsId, leaseId);
  if (lease.status !== 'approved') return false;
  const terms = await db.query('SELECT field, verified FROM lease_terms WHERE lease_id = $1', [leaseId]);
  const state = reviewState(lease, new Map(terms.map((t) => [t.field, t])));
  if (state.can_approve) return false;
  await db.query("UPDATE leases SET status = 'needs_review', approved_by = NULL, approved_at = NULL, updated_at = now() WHERE id = $1", [leaseId]);
  await logActivity(db, wsId, leaseId, actor, 'lease.reopened', `${why}. Needs verification: ${state.missing_required.map((k) => FIELD_MAP[k].label).join(', ')}`);
  return true;
}

export async function updateLeaseFields(root, wsId, leaseId, input, actor, { byPerson = false, personName = '' } = {}) {
  if (!input || typeof input !== 'object') throw new AppError('Nothing to update');
  const fields = cleanFields(input);
  const evidence = cleanEvidence(input.evidence);
  const title = text(input.title, 200, 'title');
  const notes = text(input.notes, 4000, 'notes');
  const reason = text(input.reason, 500, 'reason') || '';
  const clauses = input.other_clauses ? cleanClauses(input.other_clauses) : [];
  if (!Object.keys(fields).length && !evidence.length && title === undefined && notes === undefined && !clauses.length) throw new AppError('Nothing to update');

  return root.tx(async (db) => {
    const current = await leaseRow(db, wsId, leaseId, { lock: true });
    checkConsistency({ ...current, ...fields });
    if (!byPerson) {
      // Claude changing a key term must quote the clause (or explain why there is none), as on create.
      const req = new Set(requiredKeysFor({ ...current, ...fields }));
      const ev = new Map(evidence.map((e) => [e.field, e]));
      const missing = Object.keys(fields).filter((k) => req.has(k) && fields[k] !== null && valueText(current[k]) !== valueText(fields[k])
        && !(ev.get(k)?.clause_quote || ev.get(k)?.ambiguity));
      if (missing.length) throw new AppError(`Add an evidence entry (clause_quote, or ambiguity explaining why there is no clause) for: ${missing.join(', ')}`);
    }
    const changed = await applyChanges(db, wsId, current, fields, { mode: byPerson ? 'person' : 'claude', actor, personName, evidence, reason });
    const meta = []; const params = [];
    if (title) { params.push(title); meta.push(`title = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); meta.push(`notes = $${params.length}`); }
    if (meta.length) {
      params.push(current.id);
      await db.query(`UPDATE leases SET ${meta.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
      if (title && title !== current.title) await logActivity(db, wsId, current.id, actor, 'lease.renamed', '', { field: 'title', old_value: current.title, new_value: title });
      if (notes !== undefined && notes !== current.notes) await logActivity(db, wsId, current.id, actor, 'notes.updated', '');
    }
    for (const c of clauses) {
      await db.query('INSERT INTO other_clauses (lease_id, label, summary, clause_quote, clause_ref, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [current.id, c.label, c.summary, c.clause_quote, c.clause_ref, actor]);
    }
    if (!changed.length && evidence.length && !byPerson) await logActivity(db, wsId, current.id, actor, 'evidence.updated', evidence.map((e) => e.field).join(', '));
    const reopened = await reopenIfNeeded(db, wsId, current.id, actor, byPerson ? 'A new key term now applies' : 'Claude changed a key term');
    return { changed, reopened };
  });
}

export async function verifyTerm(root, wsId, leaseId, field, personName, verified = true) {
  if (!FIELD_MAP[field]) throw new AppError(`Unknown field ${field}`);
  return root.tx(async (db) => {
    const lease = await leaseRow(db, wsId, leaseId, { lock: true });
    await db.query(
      `INSERT INTO lease_terms (lease_id, field, verified, verified_by, verified_at, source) VALUES ($1,$2,$3,$4,${verified ? 'now()' : 'NULL'},'person')
       ON CONFLICT (lease_id, field) DO UPDATE SET verified = $3, verified_by = $4, verified_at = ${verified ? 'now()' : 'NULL'}`,
      [lease.id, field, verified, verified ? personName : null]
    );
    await logActivity(db, wsId, lease.id, `team:${personName}`, verified ? 'term.verified' : 'term.unverified', FIELD_MAP[field].label,
      { field, new_value: valueText(lease[field]) });
    if (!verified) await reopenIfNeeded(db, wsId, lease.id, `team:${personName}`, 'A key term was marked unverified');
  });
}

/** Bulk verify, for a reviewer who has read the quotes: only key terms that have a value and a quoted clause, and that
 *  neither Claude nor the engine flagged. Flagged terms must still be decided one by one. */
export async function verifyQuotedTerms(root, wsId, leaseId, personName) {
  return root.tx(async (db) => {
    const lease = await leaseRow(db, wsId, leaseId, { lock: true });
    const terms = await db.query('SELECT field, clause_quote, ambiguity, verified FROM lease_terms WHERE lease_id = $1', [lease.id]);
    const byField = new Map(terms.map((t) => [t.field, t]));
    const warned = new Set(leaseWarnings(lease).map((w) => w.field));
    const todo = requiredKeysFor(lease).filter((k) => {
      const t = byField.get(k);
      return t && !t.verified && t.clause_quote && !t.ambiguity && !warned.has(k) && lease[k] !== null && lease[k] !== '';
    });
    for (const k of todo) {
      await db.query('UPDATE lease_terms SET verified = true, verified_by = $1, verified_at = now() WHERE lease_id = $2 AND field = $3', [personName, lease.id, k]);
      await logActivity(db, wsId, lease.id, `team:${personName}`, 'term.verified', `${FIELD_MAP[k].label} (bulk, quote checked)`, { field: k, new_value: valueText(lease[k]) });
    }
    const after = await db.query('SELECT field, verified FROM lease_terms WHERE lease_id = $1', [lease.id]);
    return { verified: todo, still_to_review: reviewState(lease, new Map(after.map((t) => [t.field, t]))).missing_required };
  });
}

// Portfolio rows: how many key terms a lease has and how many still need a person to verify them.
function keyTermCounts(lease, termsByField = new Map()) {
  const st = reviewState(lease, termsByField);
  return { key_terms_total: st.required.length, key_terms_to_verify: st.missing_required.length };
}

export function reviewState(lease, termsByField) {
  const required = requiredKeysFor(lease);
  const missing = required.filter((k) => !(termsByField.get(k)?.verified) || lease[k] === null || lease[k] === undefined || lease[k] === '');
  return {
    required,
    missing_required: missing,
    can_approve: missing.length === 0 && Boolean(lease.start_date && lease.expiry_date && lease.expiry_date > lease.start_date),
  };
}

export async function approveLease(root, wsId, leaseId, personName) {
  return root.tx(async (db) => {
    const lease = await leaseRow(db, wsId, leaseId, { lock: true });
    if (lease.status === 'archived') throw new AppError('Restore the lease before approving it');
    const terms = await db.query('SELECT field, verified FROM lease_terms WHERE lease_id = $1', [lease.id]);
    const state = reviewState(lease, new Map(terms.map((t) => [t.field, t])));
    if (!state.can_approve) {
      throw new AppError(`Verify these terms first: ${state.missing_required.map((k) => FIELD_MAP[k].label).join(', ')}`);
    }
    const pending = await db.query(
      "SELECT count(*)::int AS n FROM amendment_changes c JOIN amendments a ON a.id = c.amendment_id WHERE a.lease_id = $1 AND c.status = 'pending'", [lease.id]);
    if (Number(pending[0].n)) throw new AppError('Accept or reject the pending amendment changes first');
    if (lease.status === 'approved') return { already: true };
    await db.query("UPDATE leases SET status = 'approved', approved_by = $1, approved_at = now(), updated_at = now() WHERE id = $2", [personName, lease.id]);
    await logActivity(db, wsId, lease.id, `team:${personName}`, 'lease.approved', `All ${state.required.length} key terms verified`);
    return { already: false };
  });
}

export async function setLeaseArchived(root, wsId, leaseId, archived, actor) {
  return root.tx(async (db) => {
    const lease = await leaseRow(db, wsId, leaseId, { lock: true });
    await db.query('UPDATE leases SET status = $1, approved_by = NULL, approved_at = NULL, updated_at = now() WHERE id = $2', [archived ? 'archived' : 'needs_review', lease.id]);
    await logActivity(db, wsId, lease.id, actor, archived ? 'lease.archived' : 'lease.restored', '', { field: 'status', old_value: lease.status, new_value: archived ? 'archived' : 'needs_review' });
  });
}

// ---------- actions (critical dates) ----------
export async function setActionDone(root, wsId, leaseId, actionKey, done, note, actor) {
  const key = text(actionKey, 80, 'action_key', true);
  const cleanNote = text(note, 500, 'note') || '';
  return root.tx(async (db) => {
    const lease = await leaseRow(db, wsId, leaseId, { lock: true });
    // Keys contain the date, so a key from before a correction no longer matches and is rejected.
    if (!criticalDates(lease).some((d) => d.key === key)) {
      throw new AppError(`No such action on this lease: ${key}. The dates may have changed; use an action_key from get_lease.`, 409);
    }
    if (done) {
      await db.query(
        `INSERT INTO actions_done (lease_id, action_key, note, done_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (lease_id, action_key) DO UPDATE SET note = EXCLUDED.note, done_by = EXCLUDED.done_by, done_at = now()`,
        [lease.id, key, cleanNote, actor]
      );
    } else {
      await db.query('DELETE FROM actions_done WHERE lease_id = $1 AND action_key = $2', [lease.id, key]);
    }
    await logActivity(db, wsId, lease.id, actor, done ? 'action.done' : 'action.reopened', key, { reason: cleanNote });
  });
}

// ---------- documents (letters and memos written by Claude or a person) ----------
export async function saveDocument(root, wsId, leaseId, input, actor) {
  const kind = ['letter', 'memo', 'note'].includes(input?.kind) ? input.kind : 'letter';
  const title = text(input?.title, 200, 'title', true);
  const body = text(input?.body, 20000, 'body', true);
  return root.tx(async (db) => {
    const lease = await leaseRow(db, wsId, leaseId);
    // A retried save of the same draft returns the existing document instead of a duplicate.
    const dup = await db.query(
      "SELECT id FROM documents WHERE lease_id = $1 AND title = $2 AND body = $3 AND created_at > now() - interval '10 minutes' ORDER BY id DESC LIMIT 1",
      [lease.id, title, body]);
    if (dup.length) return dup[0].id;
    const rows = await db.query('INSERT INTO documents (lease_id, workspace_id, kind, title, body, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [lease.id, wsId, kind, title, body, actor]);
    await logActivity(db, wsId, lease.id, actor, 'document.saved', `${kind}: ${title}`);
    return rows[0].id;
  });
}
export async function updateDocument(root, wsId, docId, input, actor) {
  const title = text(input?.title, 200, 'title');
  const body = text(input?.body, 20000, 'body');
  if (input?.status !== undefined && !['draft', 'sent'].includes(input.status)) throw new AppError('status must be draft or sent');
  return root.tx(async (db) => {
    const rows = await db.query('SELECT id, lease_id, title, body, status FROM documents WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [toId(docId, 'document_id'), wsId]);
    if (!rows.length) throw new AppError('Document not found', 404);
    const doc = rows[0];
    const sets = []; const params = [];
    if (title) { params.push(title); sets.push(`title = $${params.length}`); }
    if (body) { params.push(body); sets.push(`body = $${params.length}`); }
    if (input.status !== undefined) { params.push(input.status); sets.push(`status = $${params.length}`); }
    if (!sets.length) throw new AppError('Nothing to update');
    params.push(doc.id);
    await db.query(`UPDATE documents SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
    const what = [title && title !== doc.title && 'title', body && body !== doc.body && 'text'].filter(Boolean);
    if (what.length) await logActivity(db, wsId, doc.lease_id, actor, 'document.edited', `${doc.title}: edited ${what.join(' and ')}`);
    if (input.status !== undefined && input.status !== doc.status) {
      await logActivity(db, wsId, doc.lease_id, actor, 'document.status', doc.title, { field: 'document_status', old_value: doc.status, new_value: input.status });
    }
  });
}

// ---------- amendments: proposed by Claude, decided by a person ----------
/** Claude reads an amendment and proposes changed terms. Nothing on the lease changes until a person accepts. */
export async function proposeAmendment(root, wsId, leaseId, input, actor) {
  const title = text(input?.title, 200, 'title', true);
  const summary = text(input.summary, 2000, 'summary') || '';
  const effective = input.effective_date ? String(input.effective_date).trim() : null;
  if (effective && !isYmd(effective)) throw new AppError('effective_date must be a real calendar date in YYYY-MM-DD format');
  if (!Array.isArray(input.changes) || !input.changes.length) throw new AppError('changes must list at least one changed term');
  if (input.changes.length > 30) throw new AppError('At most 30 changes per amendment');
  const changes = input.changes.map((c, i) => {
    if (!c || !FIELD_MAP[c.field]) throw new AppError(`changes #${i + 1}: unknown field "${c && c.field}"`);
    const quote = text(c.clause_quote, 1500, 'clause_quote', true);
    return { field: c.field, new_value: cleanField(c.field, c.new_value), clause_quote: quote, clause_ref: text(c.clause_ref, 120, 'clause_ref') || '' };
  });
  if (new Set(changes.map((c) => c.field)).size !== changes.length) throw new AppError('Each field can appear only once per amendment');
  return root.tx(async (db) => {
    const lease = await leaseRow(db, wsId, leaseId, { lock: true });
    const real = changes.filter((c) => valueText(lease[c.field]) !== valueText(c.new_value));
    if (!real.length) throw new AppError('None of these values differ from the current lease terms');
    checkConsistency({ ...lease, ...Object.fromEntries(real.map((c) => [c.field, c.new_value])) });
    const a = await db.query('INSERT INTO amendments (lease_id, workspace_id, title, effective_date, summary, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [lease.id, wsId, title, effective, summary, actor]);
    for (const c of real) {
      await db.query('INSERT INTO amendment_changes (amendment_id, field, old_value, new_value, clause_quote, clause_ref) VALUES ($1,$2,$3,$4,$5,$6)',
        [a[0].id, c.field, valueText(lease[c.field]), valueText(c.new_value), c.clause_quote, c.clause_ref]);
    }
    await logActivity(db, wsId, lease.id, actor, 'amendment.proposed', `${title}: ${real.map((c) => FIELD_MAP[c.field].label).join(', ')}`);
    return { amendment_id: a[0].id, proposed: real.map((c) => ({ field: c.field, old_value: valueText(lease[c.field]), new_value: valueText(c.new_value) })), unchanged: changes.length - real.length };
  });
}

/** A person accepts or rejects proposed changes (one, or all pending in the amendment). Accepted changes update the
 *  lease, carry the amendment clause as evidence, and recalculate everything; the old values stay in the audit log. */
export async function decideAmendment(root, wsId, amendmentId, { changeId = null, decision }, personName) {
  if (!['accept', 'reject'].includes(decision)) throw new AppError('decision must be accept or reject');
  const actor = `team:${personName}`;
  return root.tx(async (db) => {
    const am = await db.query('SELECT * FROM amendments WHERE id = $1 AND workspace_id = $2', [toId(amendmentId, 'amendment_id'), wsId]);
    if (!am.length) throw new AppError('Amendment not found', 404);
    const amendment = am[0];
    const lease = await leaseRow(db, wsId, amendment.lease_id, { lock: true });
    const all = await db.query("SELECT * FROM amendment_changes WHERE amendment_id = $1 AND status = 'pending' ORDER BY id", [amendment.id]);
    const picked = changeId ? all.filter((c) => c.id === toId(changeId, 'change_id')) : all;
    if (!picked.length) throw new AppError('No pending change to decide', 409);
    if (decision === 'reject') {
      for (const c of picked) {
        await db.query("UPDATE amendment_changes SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2", [personName, c.id]);
        await logActivity(db, wsId, lease.id, actor, 'amendment.rejected', `${amendment.title}: ${FIELD_MAP[c.field].label}`,
          { field: c.field, old_value: c.old_value, new_value: c.new_value, source: 'person' });
      }
      return { decided: picked.length, reopened: false };
    }
    const stale = picked.filter((c) => valueText(lease[c.field]) !== c.old_value);
    if (stale.length) {
      throw new AppError(`The lease changed after this amendment was proposed (${stale.map((c) => FIELD_MAP[c.field].label).join(', ')}). Reject it and ask Claude to read the amendment again.`, 409);
    }
    const fields = Object.fromEntries(picked.map((c) => [c.field, cleanField(c.field, c.new_value)]));
    checkConsistency({ ...lease, ...fields });
    const byField = new Map(picked.map((c) => [c.field, c]));
    await applyChanges(db, wsId, lease, fields, {
      mode: 'amendment', actor, personName, reason: `Accepted from amendment "${amendment.title}"`,
      clauseFor: (f) => ({ clause_quote: byField.get(f).clause_quote, clause_ref: [amendment.title, byField.get(f).clause_ref].filter(Boolean).join(', ') }),
    });
    for (const c of picked) await db.query("UPDATE amendment_changes SET status = 'accepted', decided_by = $1, decided_at = now() WHERE id = $2", [personName, c.id]);
    const reopened = await reopenIfNeeded(db, wsId, lease.id, actor, 'The amendment made a new key term apply');
    return { decided: picked.length, reopened };
  });
}

// ---------- read models ----------
function decorateDates(lease, doneRows, today) {
  const done = new Map(doneRows.map((d) => [d.action_key, d]));
  return criticalDates(lease).map((d) => {
    const days = daysBetween(today, d.date);
    const doneRow = done.get(d.key);
    let state = 'upcoming';
    if (doneRow) state = 'done';
    else if (days < 0) state = d.severity === 'decision' ? (days >= -30 ? 'missed' : 'past') : 'past';
    else if (days <= 30) state = 'due_soon';
    return { ...d, action_key: d.key, days_left: days, state, done_by: doneRow?.done_by, done_at: doneRow?.done_at, done_note: doneRow?.note };
  });
}

async function amendmentsFor(db, leaseId) {
  const ams = await db.query('SELECT id, title, effective_date, summary, created_by, created_at FROM amendments WHERE lease_id = $1 ORDER BY id DESC', [leaseId]);
  if (!ams.length) return [];
  const changes = await db.query(
    'SELECT c.* FROM amendment_changes c JOIN amendments a ON a.id = c.amendment_id WHERE a.lease_id = $1 ORDER BY c.id', [leaseId]);
  return ams.map((a) => ({ ...a, changes: changes.filter((c) => c.amendment_id === a.id) }));
}

export async function getLease(db, wsId, leaseId, today = todayIST()) {
  const lease = await leaseRow(db, wsId, leaseId);
  // Sequential on purpose: small queries, and it keeps to one connection on constrained poolers.
  const locRows = lease.location_id ? await db.query('SELECT id, name, city, kind, owner_name FROM locations WHERE id = $1 AND workspace_id = $2', [lease.location_id, wsId]) : [];
  const terms = await db.query('SELECT field, clause_quote, clause_ref, ambiguity, verified, corrected, verified_by, verified_at, source FROM lease_terms WHERE lease_id = $1', [lease.id]);
  const clauses = await db.query('SELECT id, label, summary, clause_quote, clause_ref, created_by FROM other_clauses WHERE lease_id = $1 ORDER BY id', [lease.id]);
  const doneRows = await db.query('SELECT action_key, note, done_by, done_at FROM actions_done WHERE lease_id = $1', [lease.id]);
  const documents = await db.query('SELECT id, kind, title, body, status, created_by, created_at, updated_at FROM documents WHERE lease_id = $1 ORDER BY created_at DESC, id DESC', [lease.id]);
  const activity = await db.query('SELECT actor, action, detail, field, old_value, new_value, source, reason, created_at FROM activity WHERE lease_id = $1 ORDER BY created_at DESC, id DESC LIMIT 80', [lease.id]);
  const amendments = await amendmentsFor(db, lease.id);
  const termsByField = new Map(terms.map((t) => [t.field, t]));
  const review = reviewState(lease, termsByField);
  return {
    lease,
    location: locRows[0] || null,
    status: displayStatus(lease, today),
    terms: FIELDS.map((f) => ({ ...f, requiredWhen: undefined, required: review.required.includes(f.key), value: lease[f.key], evidence: termsByField.get(f.key) || null })),
    review,
    warnings: leaseWarnings(lease),
    ambiguities: terms.filter((t) => t.ambiguity && !t.verified).map((t) => ({ field: t.field, label: FIELD_MAP[t.field]?.label || t.field, note: t.ambiguity })),
    lock_in: lockIn(lease),
    tax: taxScope(lease),
    clauses,
    dates: decorateDates(lease, doneRows, today),
    schedule: rentSchedule(lease),
    yearly: yearlySummary(lease),
    money: commitments(lease, today),
    documents,
    amendments,
    pending_changes: amendments.flatMap((a) => a.changes.filter((c) => c.status === 'pending')).length,
    activity,
  };
}

export async function portfolio(db, wsId, { daysAhead = 90, today = todayIST() } = {}) {
  const raw = await db.query(
    `SELECT l.*, loc.name AS location_name, loc.city AS location_city, loc.owner_name AS location_owner
     FROM leases l LEFT JOIN locations loc ON loc.id = l.location_id WHERE l.workspace_id = $1 ORDER BY loc.city, loc.name, l.id`, [wsId]);
  const leases = raw.map(normalizeLease);
  const done = leases.length ? await db.query(
    'SELECT d.lease_id, d.action_key, d.note, d.done_by, d.done_at FROM actions_done d JOIN leases l ON l.id = d.lease_id WHERE l.workspace_id = $1', [wsId]) : [];
  const termRows = leases.length ? await db.query(
    'SELECT t.lease_id, t.field, t.verified FROM lease_terms t JOIN leases l ON l.id = t.lease_id WHERE l.workspace_id = $1', [wsId]) : [];
  const pending = leases.length ? await db.query(
    "SELECT a.lease_id, count(*)::int AS n FROM amendment_changes c JOIN amendments a ON a.id = c.amendment_id WHERE a.workspace_id = $1 AND c.status = 'pending' GROUP BY a.lease_id", [wsId]) : [];
  const locCount = await db.query('SELECT count(*)::int AS n FROM locations WHERE workspace_id = $1', [wsId]);
  const unv = new Map();
  const termsOf = new Map();
  for (const t of termRows) {
    if (!t.verified) unv.set(t.lease_id, (unv.get(t.lease_id) || 0) + 1);
    if (!termsOf.has(t.lease_id)) termsOf.set(t.lease_id, new Map());
    termsOf.get(t.lease_id).set(t.field, t);
  }
  const pend = new Map(pending.map((u) => [u.lease_id, Number(u.n)]));
  const horizon = addDays(today, daysAhead);
  const actions = [];
  const rows = leases.map((l) => {
    const status = displayStatus(l, today);
    const dates = decorateDates(l, done.filter((d) => d.lease_id === l.id), today);
    const live = status !== 'archived';
    const warnings = leaseWarnings(l);
    for (const d of dates) {
      if (!live || d.severity === 'info' && d.type !== 'expiry' && d.type !== 'lockin_last_day') continue;
      const item = { ...d, lease_id: l.id, lease_title: l.title, location: l.location_name, currency: l.currency, verified_lease: l.status === 'approved' };
      if ((d.state === 'due_soon' || d.state === 'upcoming') && d.date <= horizon) actions.push(item);
      if (d.state === 'missed') actions.push(item);
    }
    const next = dates.find((d) => d.state === 'missed' || d.state === 'due_soon' || d.state === 'upcoming');
    return {
      id: l.id, title: l.title, location: l.location_name, city: l.location_city, owner: l.location_owner, landlord: l.landlord_name,
      status, currency: l.currency, start_date: l.start_date, expiry_date: l.expiry_date,
      unverified_terms: unv.get(l.id) || 0, ...keyTermCounts(l, termsOf.get(l.id)), pending_amendment_changes: pend.get(l.id) || 0, warnings: warnings.map((w) => w.code),
      money: commitments(l, today), next_action: next || null, created_by: l.created_by,
    };
  });
  actions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Totals per currency only, from stored terms. Different currencies are never added together.
  const byCur = {};
  for (const r of rows) {
    if (!r.money || r.status === 'archived' || r.status === 'expired') continue;
    (byCur[r.currency] ||= []).push(r);
  }
  const totals = Object.fromEntries(Object.entries(byCur).map(([c, list]) => [c, {
    leases: list.length,
    monthly_outflow_now: addAmounts(list.map((r) => r.money.monthly_outflow_now), c),
    committed_until_lock_in_end: addAmounts(list.map((r) => r.money.committed_until_lock_in_end), c),
    remaining_total: addAmounts(list.map((r) => r.money.remaining_total), c),
    security_deposits: addAmounts(list.map((r) => leases.find((l) => l.id === r.id).security_deposit || 0), c),
    totals_final: list.every((r) => r.money.totals_final),
  }]));
  return {
    today, days_ahead: daysAhead, leases: rows, actions, totals_by_currency: totals,
    counts: {
      leases: rows.length,
      active_leases: rows.filter((r) => r.money?.in_term && r.status !== 'archived').length,
      needs_review: rows.filter((r) => r.status === 'needs_review').length,
      pending_amendments: rows.filter((r) => r.pending_amendment_changes > 0).length,
      actions_due: actions.length,
      locations: Number(locCount[0].n),
      leases_with_warnings: rows.filter((r) => r.warnings.length).length,
    },
  };
}

export function scheduleCsv(lease, schedule) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const taxName = taxScope(lease).name;
  const lines = [['Month', 'Period start', `Rent (${lease.currency})`, 'CAM / service charges', taxName, `Amount with ${taxName} not stated in agreement`, `Total payable (excl. unresolved ${taxName})`].map(esc).join(',')];
  for (const r of schedule) lines.push([r.month, r.period_start, r.rent, r.cam, r.tax, r.tax_unresolved_on, r.total].map(esc).join(','));
  return lines.join('\n');
}

export async function resetDemo(root, wsId) {
  return root.tx(async (db) => {
    const ws = await db.query('SELECT is_demo FROM workspaces WHERE id = $1', [wsId]);
    if (!ws[0]?.is_demo) throw new AppError('Only the demo workspace can be reset', 403);
    await db.query('DELETE FROM leases WHERE workspace_id = $1', [wsId]);
    await db.query('DELETE FROM locations WHERE workspace_id = $1', [wsId]);
    await db.query('DELETE FROM activity WHERE workspace_id = $1', [wsId]);
    await seedDemoLeases(db, wsId);
  });
}
