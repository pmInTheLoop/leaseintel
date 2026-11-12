// The lease terms LeaseIntel tracks. One list drives validation, the review screen, the MCP schema and approval.
// type: text | date | months (whole months) | money (max 2 decimals) | percent (max 4 decimals) | number | currency | enum
export const FIELDS = [
  { key: 'landlord_name', label: 'Landlord / licensor', type: 'text', max: 200 },
  { key: 'premises_address', label: 'Premises', type: 'text', max: 500 },
  { key: 'area_sqft', label: 'Area (sq ft)', type: 'number', min: 0, max: 10000000, decimals: 2 },
  { key: 'start_date', label: 'Start date', type: 'date', required: true },
  { key: 'expiry_date', label: 'Expiry date (last day)', type: 'date', required: true },
  { key: 'lock_in_months', label: 'Lock-in (months)', type: 'months', required: true },
  { key: 'notice_months', label: 'Notice to terminate (months)', type: 'months', required: true },
  {
    key: 'lock_in_notice_policy', label: 'Exit notice during lock-in', type: 'enum',
    options: ['not_specified', 'may_serve_during_lock_in', 'must_wait_until_after_lock_in'],
    requiredWhen: (l) => isPositive(l.lock_in_months) && isPositive(l.notice_months),
  },
  { key: 'monthly_rent', label: 'Starting monthly rent', type: 'money', required: true },
  { key: 'currency', label: 'Currency', type: 'currency' },
  { key: 'escalation_percent', label: 'Escalation %', type: 'percent', required: true },
  { key: 'escalation_every_months', label: 'Escalation every (months)', type: 'months', required: true },
  {
    key: 'escalation_basis', label: 'Escalation applied on', type: 'enum', options: ['compound', 'base'],
    requiredWhen: (l) => isPositive(l.escalation_percent) && isPositive(l.escalation_every_months),
  },
  { key: 'first_escalation_date', label: 'First escalation date (if not start + interval)', type: 'date' },
  { key: 'security_deposit', label: 'Security deposit', type: 'money', required: true },
  { key: 'cam_monthly', label: 'CAM / service charges per month', type: 'money' },
  { key: 'tax_name', label: 'Tax name (GST, VAT...)', type: 'text', max: 40 },
  { key: 'tax_percent', label: 'Tax rate %', type: 'percent' },
  {
    key: 'tax_on_rent', label: 'Tax applies to rent', type: 'enum', options: ['unknown', 'yes', 'no'],
    requiredWhen: (l) => isPositive(l.tax_percent),
  },
  {
    key: 'tax_on_charges', label: 'Tax applies to CAM / service charges', type: 'enum', options: ['unknown', 'yes', 'no'],
    requiredWhen: (l) => isPositive(l.tax_percent) && isPositive(l.cam_monthly),
  },
  { key: 'payment_due_day', label: 'Rent due day of month', type: 'number', min: 1, max: 31, integer: true },
  { key: 'renewal_term_months', label: 'Renewal option term (months, 0 = none)', type: 'months' },
  { key: 'renewal_notice_months', label: 'Notice to exercise renewal (months)', type: 'months' },
];

function isPositive(v) {
  if (v === null || v === undefined || v === '') return false;
  return /[1-9]/.test(String(v)); // works for numbers and NUMERIC strings without float parsing
}

export const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
export const FIELD_KEYS = FIELDS.map((f) => f.key);
/** Always required before approval. */
export const REQUIRED_KEYS = FIELDS.filter((f) => f.required).map((f) => f.key);
/** Required for this lease: the always-required terms plus terms that matter given the others
 *  (e.g. tax scope once a tax rate is set, the notice policy once there is a lock-in and a notice period). */
export function requiredKeysFor(lease) {
  return FIELDS.filter((f) => f.required || (f.requiredWhen && f.requiredWhen(lease))).map((f) => f.key);
}
export const MONEY_KEYS = FIELDS.filter((f) => f.type === 'money').map((f) => f.key);
export const ENUM_LABEL = {
  compound: 'last paid rent (compounding)',
  base: 'original base rent (simple)',
  not_specified: 'agreement does not say',
  may_serve_during_lock_in: 'may be served during lock-in',
  must_wait_until_after_lock_in: 'only after lock-in ends',
  unknown: 'agreement does not say',
  yes: 'yes',
  no: 'no',
};
