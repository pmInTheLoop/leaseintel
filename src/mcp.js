// MCP server: the customer's own Claude calls these tools.
// Claude reads leases and writes letters; these tools only validate, save, calculate and return records.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FIELDS, FIELD_KEYS } from './fields.js';
import { isYmd } from './engine.js';
import {
  portfolio, getLease, createLease, updateLeaseFields, createLocation, listLocations, saveDocument, setActionDone,
  proposeAmendment, publicValue,
} from './logic.js';

const INSTRUCTIONS = `LeaseIntel is a lease obligations desk for businesses that rent many locations (stores, cafes, clinics, offices).
You read lease agreements the user shares and save their key terms; LeaseIntel stores them, a person verifies each
term against the clause you quoted and approves the lease, and LeaseIntel then calculates every critical date
(lock-in, exit notice, renewal option deadline, escalations, expiry) and the full rent schedule.
Rules for you:
- Quote the exact clause text and its clause/page reference for every term you extract (the evidence list).
  A person checks your quote, so never paraphrase inside clause_quote. Never invent a clause reference.
- If the lease does not state a term, leave the field out rather than guessing, and say so in notes.
- If a clause is unclear or could be read two ways, still quote it and explain the doubt in that evidence entry's
  "ambiguity". The person resolves it. Do not pick a reading silently.
- Dates are real calendar dates in YYYY-MM-DD. Expiry is the last day of the term. Months are whole numbers.
  Money is a plain number in the lease currency (max 2 decimals). Percentages max 4 decimals.
- escalation_basis: "compound" when each increase applies to the last paid rent, "base" when it applies to the original rent.
- lock_in_notice_policy: "may_serve_during_lock_in" only if the agreement says notice can be given during the lock-in;
  "must_wait_until_after_lock_in" only if it says termination/notice is allowed only after the lock-in;
  otherwise "not_specified" with an ambiguity note. LeaseIntel will not compute an exit deadline from a guess.
- Tax: tax_name as written (GST, VAT...), tax_percent, and whether it applies to rent (tax_on_rent) and to CAM /
  service charges (tax_on_charges): "yes", "no", or "unknown" when the agreement does not say. Never assume.
- Amendments, addenda and side letters: use propose_amendment, not update_lease_terms. The old terms stay until a
  person accepts each change.
- LeaseIntel never sends anything. Letters you draft are saved as drafts for a person to send.
Always share the app_url you get back so the person can review.`;

const decimals = (v) => { const m = /\.(\d+)$/.exec(String(v)); return m ? m[1].length : 0; };
const fieldShape = {};
for (const f of FIELDS) {
  let s;
  if (f.type === 'text') s = z.string().max(f.max);
  else if (f.type === 'date') s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine(isYmd, 'not a real calendar date').describe('YYYY-MM-DD');
  else if (f.type === 'currency') s = z.string().length(3).describe('ISO code, e.g. INR, SGD, AED, USD');
  else if (f.type === 'enum') s = z.enum(f.options);
  else if (f.type === 'months') s = z.number().int('whole months only').min(0).max(1200);
  else if (f.integer) s = z.number().int().min(f.min).max(f.max);
  else if (f.type === 'percent') s = z.number().min(0).max(100).refine((v) => decimals(v) <= 4, 'max 4 decimal places');
  else s = z.number().min(0).refine((v) => decimals(v) <= 2, 'max 2 decimal places');
  const hint = f.type === 'enum' ? `: ${f.options.join(' | ')}` : f.type === 'months' ? ' (whole months)' : '';
  fieldShape[f.key] = s.optional().describe(f.label + hint);
}
const evidenceShape = z.array(z.object({
  field: z.enum(FIELD_KEYS),
  clause_quote: z.string().max(1500).optional().describe('Exact words from the lease that state this term'),
  clause_ref: z.string().max(120).optional().describe('e.g. "Clause 5.2, page 3"'),
  ambiguity: z.string().max(500).optional().describe('Only if the clause is unclear, missing or open to two readings: explain the doubt'),
})).describe('One entry per term you extracted, quoting the clause it came from');
const clausesShape = z.array(z.object({
  label: z.string().max(120).describe('e.g. Subletting, Fit-out period, Exclusivity, Signage, Termination by landlord'),
  summary: z.string().max(1000).optional(),
  clause_quote: z.string().max(1500).optional(),
  clause_ref: z.string().max(120).optional(),
})).describe('Other clauses the business should know about');

const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] });
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function buildMcpServer({ db, workspace, baseUrl }) {
  const wsId = workspace.id;
  const actor = 'claude';
  const appUrl = (id) => `${baseUrl}/app/l/${id}`;
  const server = new McpServer({ name: 'leaseintel', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  const leaseView = (d, { full = false } = {}) => ({
    lease_id: d.lease.id,
    title: d.lease.title,
    location: d.location,
    status: d.status,
    approved_by: d.lease.approved_by || undefined,
    review: {
      unverified_required_terms: d.review.missing_required,
      can_approve: d.review.can_approve,
      note: 'Only a person can verify terms and approve a lease, in the LeaseIntel app.',
    },
    needs_attention: [...d.warnings.map((w) => w.message), ...d.ambiguities.map((a) => `${a.label}: ${a.note}`)],
    terms: Object.fromEntries(d.terms.filter((t) => t.value !== null && t.value !== undefined && t.value !== '').map((t) => [t.key, {
      value: publicValue(t.key, t.value), verified: Boolean(t.evidence?.verified), corrected_by_person: Boolean(t.evidence?.corrected),
      ...(full && t.evidence?.clause_quote ? { clause: t.evidence.clause_quote, ref: t.evidence.clause_ref } : {}),
      ...(full && t.evidence?.ambiguity ? { ambiguity: t.evidence.ambiguity } : {}),
    }])),
    lock_in: d.lock_in,
    tax: d.tax,
    money: d.money,
    critical_dates: d.dates.map((x) => ({ action_key: x.action_key, date: x.date, label: x.label, days_left: x.days_left, state: x.state, detail: x.detail })),
    yearly_rent: d.yearly.map((y) => ({ year: y.year, from: y.from, monthly_rent: y.monthly_rent_to, total_payable: y.total, tax_not_stated_on: y.tax_unresolved_on || undefined })),
    other_clauses: d.clauses.map((c) => ({ label: c.label, summary: c.summary, ref: c.clause_ref })),
    pending_amendment_changes: d.amendments.flatMap((a) => a.changes.filter((c) => c.status === 'pending').map((c) => ({ amendment: a.title, field: c.field, from: c.old_value, to: c.new_value }))),
    documents: d.documents.map((x) => ({ document_id: x.id, kind: x.kind, title: x.title, status: x.status, ...(full ? { body: x.body } : {}) })),
    app_url: appUrl(d.lease.id),
  });

  server.registerTool('list_portfolio', {
    title: 'List leases and upcoming actions',
    description: 'Read the whole lease portfolio: every location and lease, rent now, what is committed, leases waiting for review, and every action due in the next N days (notice deadlines, escalations, renewal deadlines, expiries). Use it to answer "what needs attention".',
    inputSchema: { days_ahead: z.number().int().min(1).max(730).optional().describe('Look-ahead window, default 90') },
    annotations: RO,
  }, async ({ days_ahead }) => {
    try {
      const p = await portfolio(db, wsId, { daysAhead: days_ahead || 90 });
      return ok({
        today: p.today, counts: p.counts, totals_by_currency: p.totals_by_currency,
        actions: p.actions.map((a) => ({ date: a.date, days_left: a.days_left, state: a.state, label: a.label, detail: a.detail, lease_id: a.lease_id, location: a.location, action_key: a.action_key, lease_verified: a.verified_lease })),
        leases: p.leases.map((l) => ({ lease_id: l.id, title: l.title, location: l.location, city: l.city, status: l.status, currency: l.currency, rent_now: l.money?.rent_now, monthly_outflow_now: l.money?.monthly_outflow_now, totals_final: l.money?.totals_final, expiry_date: l.expiry_date, unverified_terms: l.unverified_terms, pending_amendment_changes: l.pending_amendment_changes || undefined, warnings: l.warnings.length ? l.warnings : undefined, next_action: l.next_action && { date: l.next_action.date, label: l.next_action.label }, app_url: appUrl(l.id) })),
        note: 'Totals are per currency and never added across currencies. totals_final=false means the agreement does not state the tax on some charges.',
        app_url: `${baseUrl}/app`,
      });
    } catch (err) { return fail(err); }
  });

  server.registerTool('get_lease', {
    title: 'Get one lease',
    description: 'Read one lease in full: each term with its quoted clause and whether a person has verified it, the computed critical dates (with action_key), the yearly rent schedule, other clauses and saved letters.',
    inputSchema: { lease_id: z.number().int().positive() },
    annotations: RO,
  }, async ({ lease_id }) => {
    try { return ok(leaseView(await getLease(db, wsId, lease_id), { full: true })); } catch (err) { return fail(err); }
  });

  server.registerTool('create_lease', {
    title: 'Save a lease you read',
    description: 'Save the key terms of a lease agreement the user shared with you. Give each term as a field, plus an evidence entry quoting the exact clause. The lease lands in LeaseIntel as "Needs review" until a person verifies the terms. Use location to create the store/office, or location_id for an existing one (see list_portfolio).',
    inputSchema: {
      title: z.string().max(200).optional().describe('e.g. "Indiranagar cafe: leave and license"'),
      location_id: z.number().int().positive().optional(),
      location: z.object({ name: z.string().max(120), city: z.string().max(80).optional(), kind: z.string().max(40).optional().describe('store, cafe, office, warehouse, clinic'), owner_name: z.string().max(120).optional() }).optional(),
      ...fieldShape,
      evidence: evidenceShape.optional(),
      other_clauses: clausesShape.optional(),
      notes: z.string().max(4000).optional().describe('Terms the lease does not state, and anything else the reviewer should know'),
      allow_duplicate: z.boolean().optional().describe('Only true if a lease with the same location, dates and rent really is a separate agreement'),
    },
    annotations: RW,
  }, async (args) => {
    try {
      const id = await createLease(db, wsId, args, actor);
      const d = await getLease(db, wsId, id);
      return ok({ message: `Saved lease ${id} as Needs review. A person must verify the terms in LeaseIntel before it is approved.`, ...leaseView(d) });
    } catch (err) { return fail(err); }
  });

  server.registerTool('update_lease_terms', {
    title: 'Correct or add lease terms',
    description: 'Correct or add terms you extracted from the same agreement, with new evidence quotes. Any term you change becomes unverified again, and an approved lease goes back to "Needs review" if a key term changes. For a signed amendment or addendum use propose_amendment instead.',
    inputSchema: { lease_id: z.number().int().positive(), title: z.string().max(200).optional(), ...fieldShape, evidence: evidenceShape.optional(), other_clauses: clausesShape.optional(), notes: z.string().max(4000).optional() },
    annotations: { ...RW, idempotentHint: true },
  }, async ({ lease_id, ...rest }) => {
    try {
      const r = await updateLeaseFields(db, wsId, lease_id, rest, actor);
      return ok({ message: `Updated: ${r.changed.join(', ') || 'no value changed'}.${r.reopened ? ' Lease sent back for review.' : ''}`, app_url: appUrl(lease_id) });
    } catch (err) { return fail(err); }
  });

  server.registerTool('add_location', {
    title: 'Add a location',
    description: 'Create a store, cafe, office or warehouse that leases can belong to.',
    inputSchema: { name: z.string().max(120), city: z.string().max(80).optional(), kind: z.string().max(40).optional(), owner_name: z.string().max(120).optional() },
    annotations: RW,
  }, async (args) => {
    try {
      const id = await createLocation(db, wsId, args, actor);
      return ok({ location_id: id, locations: await listLocations(db, wsId) });
    } catch (err) { return fail(err); }
  });

  server.registerTool('save_document', {
    title: 'Save a letter or memo you drafted',
    description: 'Save a letter (renewal notice, exit notice, rent-escalation query to the landlord) or an internal memo against a lease. It is stored as a draft; a person reviews and sends it. LeaseIntel never sends anything.',
    inputSchema: { lease_id: z.number().int().positive(), kind: z.enum(['letter', 'memo', 'note']).optional(), title: z.string().max(200), body: z.string().max(20000) },
    annotations: RW,
  }, async ({ lease_id, ...doc }) => {
    try {
      const id = await saveDocument(db, wsId, lease_id, doc, actor);
      return ok({ message: 'Saved as a draft. A person will review and send it.', document_id: id, app_url: appUrl(lease_id) });
    } catch (err) { return fail(err); }
  });

  server.registerTool('mark_action_done', {
    title: 'Mark a critical date handled',
    description: 'Mark a critical date (from get_lease, by action_key) as handled, only when the user tells you it was done, e.g. the notice was sent. Use done=false to reopen.',
    inputSchema: { lease_id: z.number().int().positive(), action_key: z.string().max(80), done: z.boolean().optional(), note: z.string().max(500).optional() },
    annotations: { ...RW, idempotentHint: true },
  }, async ({ lease_id, action_key, done, note }) => {
    try {
      await setActionDone(db, wsId, lease_id, action_key, done !== false, note, actor);
      return ok({ message: done === false ? 'Reopened.' : 'Marked as done.', app_url: appUrl(lease_id) });
    } catch (err) { return fail(err); }
  });

  server.registerTool('propose_amendment', {
    title: 'Propose changes from a lease amendment',
    description: 'Use when the user shares an amendment, addendum or side letter to a lease already in LeaseIntel. Find the lease (list_portfolio, get_lease), compare each term, and send only the terms the amendment changes, each with the exact new clause. Nothing on the lease changes until a person accepts each change in LeaseIntel; the old values stay in the history.',
    inputSchema: {
      lease_id: z.number().int().positive(),
      title: z.string().max(200).describe('e.g. "Addendum 1 dated 2026-10-01"'),
      effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isYmd, 'not a real calendar date').optional(),
      summary: z.string().max(2000).optional(),
      changes: z.array(z.object({
        field: z.enum(FIELD_KEYS),
        new_value: z.union([z.string().max(500), z.number()]).describe('New value in the same format as create_lease'),
        clause_quote: z.string().min(1).max(1500).describe('Exact words of the amendment that make this change'),
        clause_ref: z.string().max(120).optional(),
      })).min(1).max(30),
    },
    annotations: RW,
  }, async ({ lease_id, ...rest }) => {
    try {
      const r = await proposeAmendment(db, wsId, lease_id, rest, actor);
      return ok({ message: `Proposed ${r.proposed.length} change(s). A person must accept or reject each one in LeaseIntel; the lease keeps its current terms until then.`, ...r, app_url: appUrl(lease_id) });
    } catch (err) { return fail(err); }
  });

  return server;
}
