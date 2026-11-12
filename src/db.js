// Database layer. Plain SQL, no ORM.
// Production: Postgres via DATABASE_URL (Neon, Supabase, Render, any Postgres).
// Local dev and tests: PGlite (Postgres compiled to WASM), so no database server is needed.
import crypto from 'node:crypto';

let dbPromise = null;

/** Every driver exposes query(sql, params) → rows, and tx(fn): fn gets a db bound to one transaction.
 *  A tx() call inside a transaction joins it, so business functions can be composed safely. */
function boundDb(kind, run) {
  const inner = { kind, inTx: true, query: run, tx: (fn) => fn(inner) };
  return inner;
}

async function createDriver() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { default: pg } = await import('pg');
    // Small pool per serverless instance; use the provider's pooled connection string (e.g. Neon "-pooler" host).
    const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    return {
      kind: 'postgres',
      query: async (sql, params = []) => (await pool.query(sql, params)).rows,
      async tx(fn) {
        // One dedicated client for the whole transaction: BEGIN, every statement and COMMIT run on the same connection.
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(boundDb('postgres', async (sql, params = []) => (await client.query(sql, params)).rows));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is not set. LeaseIntel needs a Postgres database in production.');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(process.env.PGLITE_DIR || undefined);
  return {
    kind: 'pglite',
    query: async (sql, params = []) => (await db.query(sql, params)).rows,
    // PGlite's own transaction: commits when fn resolves, rolls back when it throws.
    tx: (fn) => db.transaction((t) => fn(boundDb('pglite', async (sql, params = []) => (await t.query(sql, params)).rows))),
    close: () => db.close(),
  };
}

// Money is NUMERIC (exact), months and days are INTEGER, enums are checked by the database as well as the app.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, mcp_key TEXT NOT NULL UNIQUE,
  is_demo BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'store', owner_name TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'app', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leases (
  id SERIAL PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  landlord_name TEXT NOT NULL DEFAULT '', premises_address TEXT NOT NULL DEFAULT '', area_sqft NUMERIC(14,2),
  start_date TEXT, expiry_date TEXT,
  lock_in_months INTEGER CHECK (lock_in_months >= 0), notice_months INTEGER CHECK (notice_months >= 0),
  lock_in_notice_policy TEXT NOT NULL DEFAULT 'not_specified'
    CHECK (lock_in_notice_policy IN ('not_specified','may_serve_during_lock_in','must_wait_until_after_lock_in')),
  monthly_rent NUMERIC(18,4) CHECK (monthly_rent >= 0), currency TEXT NOT NULL DEFAULT 'INR',
  escalation_percent NUMERIC(9,4) CHECK (escalation_percent >= 0), escalation_every_months INTEGER CHECK (escalation_every_months >= 0),
  escalation_basis TEXT NOT NULL DEFAULT 'compound' CHECK (escalation_basis IN ('compound','base')), first_escalation_date TEXT,
  security_deposit NUMERIC(18,4) CHECK (security_deposit >= 0), cam_monthly NUMERIC(18,4) CHECK (cam_monthly >= 0),
  tax_name TEXT NOT NULL DEFAULT '', tax_percent NUMERIC(9,4) CHECK (tax_percent >= 0),
  tax_on_rent TEXT NOT NULL DEFAULT 'unknown' CHECK (tax_on_rent IN ('unknown','yes','no')),
  tax_on_charges TEXT NOT NULL DEFAULT 'unknown' CHECK (tax_on_charges IN ('unknown','yes','no')),
  payment_due_day INTEGER CHECK (payment_due_day BETWEEN 1 AND 31),
  renewal_term_months INTEGER CHECK (renewal_term_months >= 0), renewal_notice_months INTEGER CHECK (renewal_notice_months >= 0),
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review','approved','archived')), notes TEXT NOT NULL DEFAULT '',
  approved_by TEXT, approved_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT 'app', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lease_terms (
  id SERIAL PRIMARY KEY, lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  field TEXT NOT NULL, clause_quote TEXT NOT NULL DEFAULT '', clause_ref TEXT NOT NULL DEFAULT '',
  ambiguity TEXT NOT NULL DEFAULT '',
  verified BOOLEAN NOT NULL DEFAULT false, corrected BOOLEAN NOT NULL DEFAULT false,
  verified_by TEXT, verified_at TIMESTAMPTZ, source TEXT NOT NULL DEFAULT 'claude',
  UNIQUE (lease_id, field)
);
CREATE TABLE IF NOT EXISTS other_clauses (
  id SERIAL PRIMARY KEY, lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  label TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', clause_quote TEXT NOT NULL DEFAULT '', clause_ref TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'app', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS actions_done (
  id SERIAL PRIMARY KEY, lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', done_by TEXT NOT NULL, done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lease_id, action_key)
);
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY, lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'letter', title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  created_by TEXT NOT NULL DEFAULT 'app', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS amendments (
  id SERIAL PRIMARY KEY, lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL, effective_date TEXT, summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS amendment_changes (
  id SERIAL PRIMARY KEY, amendment_id INTEGER NOT NULL REFERENCES amendments(id) ON DELETE CASCADE,
  field TEXT NOT NULL, old_value TEXT, new_value TEXT, clause_quote TEXT NOT NULL DEFAULT '', clause_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','superseded')),
  decided_by TEXT, decided_at TIMESTAMPTZ,
  UNIQUE (amendment_id, field)
);
CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lease_id INTEGER REFERENCES leases(id) ON DELETE CASCADE, actor TEXT NOT NULL, action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '', field TEXT, old_value TEXT, new_value TEXT,
  source TEXT NOT NULL DEFAULT 'app', reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE RULE activity_append_only AS ON UPDATE TO activity DO INSTEAD NOTHING;
CREATE INDEX IF NOT EXISTS leases_ws_idx ON leases(workspace_id);
CREATE INDEX IF NOT EXISTS activity_lease_idx ON activity(lease_id);
CREATE INDEX IF NOT EXISTS amendments_lease_idx ON amendments(lease_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)
`;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(password, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const randomToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

export const DEMO = {
  email: process.env.DEMO_EMAIL || 'demo@leaseintel.app',
  password: process.env.DEMO_PASSWORD || 'leaseintel-demo',
  mcpKey: process.env.DEMO_MCP_KEY || 'li_demo_volopay_2026',
  workspace: 'Kettle & Crumb Cafes (demo)',
};

// Two sample leases so the portfolio is not empty. The demo adds a third one live from Claude.
// All companies, people and addresses are fictional.
export const SAMPLE_LEASES = [
  {
    location: { name: 'Koregaon Park cafe', city: 'Pune', kind: 'store', owner_name: 'Riya (Ops, West)' },
    lease: {
      title: 'Koregaon Park cafe: leave and license', landlord_name: 'Nandini Patil', premises_address: 'Shop 4, Lane 6, Koregaon Park, Pune 411001',
      area_sqft: 1100, start_date: '2024-04-01', expiry_date: '2029-03-31', lock_in_months: 24, notice_months: 2,
      lock_in_notice_policy: 'must_wait_until_after_lock_in',
      monthly_rent: 145000, currency: 'INR', escalation_percent: 5, escalation_every_months: 12, escalation_basis: 'compound',
      security_deposit: 870000, cam_monthly: 12000, tax_name: 'GST', tax_percent: 18, tax_on_rent: 'yes', tax_on_charges: 'yes',
      payment_due_day: 5, renewal_term_months: 36, renewal_notice_months: 3,
    },
    clauses: [
      { label: 'Subletting', summary: 'Not allowed without written consent of the licensor.', clause_quote: 'The Licensee shall not sub-license or part with possession of the premises without the prior written consent of the Licensor.', clause_ref: 'Clause 11' },
    ],
  },
  {
    location: { name: 'Tanjong Pagar kiosk', city: 'Singapore', kind: 'store', owner_name: 'Wei Ling (SG)' },
    lease: {
      title: 'Tanjong Pagar kiosk: tenancy agreement', landlord_name: 'Harbourline Properties Pte Ltd', premises_address: '#01-12, 88 Tanjong Pagar Road, Singapore 088510',
      area_sqft: 420, start_date: '2025-01-15', expiry_date: '2028-01-14', lock_in_months: 0, notice_months: 3,
      monthly_rent: 9800, currency: 'SGD', escalation_percent: 0, escalation_every_months: 0, escalation_basis: 'compound',
      security_deposit: 29400, cam_monthly: 650, tax_name: 'GST', tax_percent: 9, tax_on_rent: 'yes', tax_on_charges: 'yes',
      payment_due_day: 1, renewal_term_months: 36, renewal_notice_months: 6,
    },
    clauses: [
      { label: 'Fitting-out period', summary: '30 days rent-free fit-out before trading starts.', clause_quote: 'The Landlord grants the Tenant a rent-free fitting-out period of thirty (30) days.', clause_ref: 'Clause 3.4' },
    ],
  },
];

export async function seedDemoLeases(db, wsId) {
  for (const s of SAMPLE_LEASES) {
    const loc = await db.query(
      "INSERT INTO locations (workspace_id, name, city, kind, owner_name, created_by) VALUES ($1,$2,$3,$4,$5,'app') RETURNING id",
      [wsId, s.location.name, s.location.city, s.location.kind, s.location.owner_name]
    );
    const L = s.lease;
    const cols = Object.keys(L);
    const vals = cols.map((c) => L[c]);
    const lease = await db.query(
      `INSERT INTO leases (workspace_id, location_id, ${cols.join(', ')}, status, approved_by, approved_at, created_by)
       VALUES ($1, $2, ${cols.map((_, i) => '$' + (i + 3)).join(', ')}, 'approved', 'Demo Finance Lead', now(), 'app') RETURNING id`,
      [wsId, loc[0].id, ...vals]
    );
    const leaseId = lease[0].id;
    for (const f of cols.filter((c) => c !== 'title')) {
      await db.query(
        "INSERT INTO lease_terms (lease_id, field, clause_quote, clause_ref, verified, verified_by, verified_at, source) VALUES ($1,$2,'','Entered at setup',true,'Demo Finance Lead',now(),'person')",
        [leaseId, f]
      );
    }
    for (const c of s.clauses) {
      await db.query(
        "INSERT INTO other_clauses (lease_id, label, summary, clause_quote, clause_ref, created_by) VALUES ($1,$2,$3,$4,$5,'app')",
        [leaseId, c.label, c.summary, c.clause_quote, c.clause_ref]
      );
    }
    await db.query("INSERT INTO activity (workspace_id, lease_id, actor, action, detail, source) VALUES ($1,$2,'app','lease.created','Sample lease added at setup','app')", [wsId, leaseId]);
  }
}

async function seed(root) {
  return root.tx(async (db) => seedIn(db));
}
async function seedIn(db) {
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [DEMO.email]);
  if (existing.length) return;
  const ws = await db.query(
    'INSERT INTO workspaces (name, mcp_key, is_demo) VALUES ($1, $2, true) ON CONFLICT (mcp_key) DO UPDATE SET name = EXCLUDED.name RETURNING id',
    [DEMO.workspace, DEMO.mcpKey]
  );
  const inserted = await db.query(
    'INSERT INTO users (workspace_id, email, name, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id',
    [ws[0].id, DEMO.email, 'Demo Finance Lead', hashPassword(DEMO.password)]
  );
  if (!inserted.length) return; // a parallel cold start seeded it first
  await seedDemoLeases(db, ws[0].id);
}

export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await createDriver();
      for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
      await seed(db);
      return db;
    })().catch((err) => { dbPromise = null; throw err; });
  }
  return dbPromise;
}
