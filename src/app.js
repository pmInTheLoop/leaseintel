// HTTP app: web UI, JSON API for the UI, sample PDFs, and the MCP endpoint for Claude.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getDb, verifyPassword, hashPassword, randomToken, DEMO } from './db.js';
import {
  AppError, portfolio, getLease, createLease, updateLeaseFields, verifyTerm, approveLease, setActionDone,
  saveDocument, updateDocument, scheduleCsv, resetDemo, decideAmendment, verifyQuotedTerms,
} from './logic.js';
import { buildMcpServer } from './mcp.js';
import * as V from './views.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = [
  { file: 'indiranagar-cafe-lease.pdf', title: 'Indiranagar cafe, Bengaluru: leave and license agreement (used in the demo)' },
  { file: 'hsr-cloud-kitchen-lease.pdf', title: 'HSR Layout cloud kitchen, Bengaluru: lease deed' },
  { file: 'dubai-marina-kiosk-lease.pdf', title: 'Dubai Marina kiosk: tenancy contract (AED)' },
];
const COOKIE = 'li_session';
const SESSION_DAYS = 14;

function baseUrlOf(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}
const cookies = (hdr = '') => Object.fromEntries(hdr.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Small in-memory rate limiter (per server instance; on serverless each warm instance keeps its own window). */
function rateLimit({ windowMs, max, name }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    if (list.length > max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).send(V.errorPage(429, 'Too many attempts. Please wait a few minutes and try again.'));
    }
    next();
  };
}

/** Cookie-authenticated writes must come from our own pages: reject cross-site Origin / Sec-Fetch-Site. */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/mcp/')) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Cross-site request blocked.' });
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* malformed */ }
    if (originHost !== host) return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
}

function requireJson(req, res, next) {
  if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Content-Type must be application/json' });
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!req.path.startsWith('/mcp')) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    }
    if (req.path.startsWith('/app') || req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(sameOrigin);
  // Self-hosted fonts (the CSP allows only this origin). Served before the database middleware.
  app.use('/fonts', express.static(path.join(ROOT, 'public', 'fonts'), { maxAge: '365d', immutable: true, fallthrough: false }));
  app.get('/favicon.svg', (req, res) => res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(ROOT, 'public', 'favicon.svg')));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
  app.use(wrap(async (req, res, next) => {
    req.db = await getDb();
    req.base = baseUrlOf(req);
    const token = cookies(req.headers.cookie)[COOKIE];
    if (token) {
      const rows = await req.db.query(
        `SELECT u.id, u.name, u.email, u.workspace_id, w.name AS workspace_name FROM sessions s JOIN users u ON u.id = s.user_id
         JOIN workspaces w ON w.id = u.workspace_id WHERE s.token = $1 AND s.expires_at > now()`, [token]);
      if (rows.length) req.user = rows[0];
    }
    next();
  }));

  // This MCP server is authless (secret per-workspace URL). Answer OAuth discovery probes with 404 so clients skip OAuth.
  app.all(/^\/\.well-known\/.*/, (req, res) => res.status(404).json({ error: 'not_found' }));
  app.get('/health', wrap(async (req, res) => { await req.db.query('SELECT 1'); res.json({ ok: true, service: 'leaseintel', ai_inside: false }); }));

  // ---------------- MCP: Streamable HTTP, stateless, one server per request ----------------
  app.post('/mcp/:key', express.json({ limit: '2mb' }), wrap(async (req, res) => {
    const ws = await req.db.query('SELECT id, name FROM workspaces WHERE mcp_key = $1', [req.params.key]);
    if (!ws.length) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown LeaseIntel MCP link. Copy the current one from LeaseIntel → Connect Claude.' }, id: null });
    const server = buildMcpServer({ db: req.db, workspace: ws[0], baseUrl: req.base });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }));
  const no = (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null });
  app.get('/mcp/:key', no);
  app.delete('/mcp/:key', no);

  // ---------------- public ----------------
  app.get('/', (req, res) => (req.user ? res.redirect('/app') : res.send(V.landingPage(req.base))));
  app.get('/connect', (req, res) => res.send(V.connectPublicPage(req.base, DEMO.mcpKey)));
  app.get('/samples', (req, res) => res.send(V.samplesPage(SAMPLES)));
  app.get('/samples/:file', (req, res, next) => {
    const s = SAMPLES.find((x) => x.file === req.params.file);
    if (!s) return next();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${s.file}"`);
    res.send(fs.readFileSync(path.join(ROOT, 'samples', s.file)));
  });
  app.get('/login', (req, res) => res.send(V.authPage({ mode: 'login', demo: DEMO })));
  app.get('/signup', (req, res) => res.send(V.authPage({ mode: 'signup', demo: DEMO })));

  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const secureCookie = (req) => (req.base.startsWith('https') || process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '');
  async function startSession(req, res, userId) {
    const token = randomToken(24);
    await req.db.query('DELETE FROM sessions WHERE expires_at < now()');
    await req.db.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [token, userId]);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookie(req)}`);
  }
  const loginLimit = rateLimit({ name: 'login', windowMs: 10 * 60 * 1000, max: Number(process.env.LOGIN_RATE_MAX || 30) });
  const signupLimit = rateLimit({ name: 'signup', windowMs: 60 * 60 * 1000, max: Number(process.env.SIGNUP_RATE_MAX || 10) });
  app.post('/login', loginLimit, form, wrap(async (req, res) => {
    const password = String(req.body.password || '');
    const rows = password.length > 200 ? [] : await req.db.query('SELECT id, password_hash FROM users WHERE email = $1', [String(req.body.email || '').trim().toLowerCase()]);
    if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).send(V.authPage({ mode: 'login', error: 'Wrong email or password.', demo: DEMO }));
    }
    await startSession(req, res, rows[0].id);
    res.redirect('/app');
  }));
  app.post('/signup', signupLimit, form, wrap(async (req, res) => {
    const company = String(req.body.company || '').trim().slice(0, 120);
    const name = String(req.body.name || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const fail = (m) => res.status(400).send(V.authPage({ mode: 'signup', error: m, demo: DEMO }));
    if (!company || !name) return fail('Company name and your name are required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.');
    if (password.length < 8 || password.length > 200) return fail('Password must be 8 to 200 characters.');
    if ((await req.db.query('SELECT 1 FROM users WHERE email = $1', [email])).length) return fail('That email already has an account. Log in instead.');
    const hash = hashPassword(password);
    const userId = await req.db.tx(async (db) => {
      const ws = await db.query('INSERT INTO workspaces (name, mcp_key) VALUES ($1, $2) RETURNING id', [company, 'li_' + randomToken(24)]);
      const u = await db.query('INSERT INTO users (workspace_id, email, name, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id', [ws[0].id, email, name, hash]);
      if (!u.length) throw new AppError('That email already has an account. Log in instead.');
      return u[0].id;
    }).catch((err) => { if (err instanceof AppError) return null; throw err; });
    if (!userId) return fail('That email already has an account. Log in instead.');
    await startSession(req, res, userId);
    res.redirect('/app/settings');
  }));
  app.post('/logout', wrap(async (req, res) => {
    const token = cookies(req.headers.cookie)[COOKIE];
    if (token) await req.db.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie(req)}`);
    res.redirect('/');
  }));

  // ---------------- app (login required) ----------------
  const needUser = (req, res, next) => {
    if (req.user) return next();
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Please log in again.' });
    return res.redirect('/login');
  };
  const me = (req) => `team:${req.user.name}`;

  app.get('/app', needUser, wrap(async (req, res) => res.send(V.portfolioPage({ user: req.user, p: await portfolio(req.db, req.user.workspace_id) }))));
  app.get('/app/l/:id', needUser, wrap(async (req, res) => res.send(V.leasePage({ user: req.user, d: await getLease(req.db, req.user.workspace_id, req.params.id) }))));
  app.get('/app/l/:id/schedule.csv', needUser, wrap(async (req, res) => {
    const d = await getLease(req.db, req.user.workspace_id, req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${d.lease.title.replace(/[^\w-]+/g, '_').slice(0, 60)}_rent_schedule.csv"`);
    res.send('﻿' + scheduleCsv(d.lease, d.schedule));
  }));
  app.get('/app/settings', needUser, wrap(async (req, res) => {
    const ws = await req.db.query('SELECT id, name, mcp_key, is_demo FROM workspaces WHERE id = $1', [req.user.workspace_id]);
    res.send(V.settingsPage({ user: req.user, ws: ws[0], baseUrl: req.base }));
  }));

  const api = express.Router();
  api.use(needUser, requireJson, express.json({ limit: '1mb' }));
  api.get('/portfolio', wrap(async (req, res) => res.json(await portfolio(req.db, req.user.workspace_id))));
  api.get('/leases/:id', wrap(async (req, res) => res.json(await getLease(req.db, req.user.workspace_id, req.params.id))));
  api.post('/leases', wrap(async (req, res) => {
    const id = await createLease(req.db, req.user.workspace_id, req.body || {}, me(req), { byPerson: true, personName: req.user.name });
    res.json({ ok: true, id, redirect: `/app/l/${id}` });
  }));
  api.patch('/leases/:id', wrap(async (req, res) => {
    res.json({ ok: true, ...(await updateLeaseFields(req.db, req.user.workspace_id, req.params.id, req.body || {}, me(req), { byPerson: true, personName: req.user.name })) });
  }));
  api.post('/leases/:id/verify', wrap(async (req, res) => {
    await verifyTerm(req.db, req.user.workspace_id, req.params.id, String(req.body.field || ''), req.user.name, req.body.verified !== false);
    res.json({ ok: true });
  }));
  api.post('/leases/:id/verify-quoted', wrap(async (req, res) => res.json({ ok: true, ...(await verifyQuotedTerms(req.db, req.user.workspace_id, req.params.id, req.user.name)) })));
  api.post('/leases/:id/approve', wrap(async (req, res) => { await approveLease(req.db, req.user.workspace_id, req.params.id, req.user.name); res.json({ ok: true }); }));
  api.post('/leases/:id/actions', wrap(async (req, res) => {
    await setActionDone(req.db, req.user.workspace_id, req.params.id, req.body.action_key, req.body.done !== false, req.body.note, me(req));
    res.json({ ok: true });
  }));
  api.post('/leases/:id/documents', wrap(async (req, res) => res.json({ ok: true, id: await saveDocument(req.db, req.user.workspace_id, req.params.id, req.body || {}, me(req)) })));
  api.post('/amendments/:id/decide', wrap(async (req, res) => {
    res.json({ ok: true, ...(await decideAmendment(req.db, req.user.workspace_id, req.params.id, { changeId: req.body.change_id ?? null, decision: req.body.decision }, req.user.name)) });
  }));
  api.patch('/documents/:id', wrap(async (req, res) => { await updateDocument(req.db, req.user.workspace_id, req.params.id, req.body || {}, me(req)); res.json({ ok: true }); }));
  api.post('/settings/rotate-key', wrap(async (req, res) => {
    const ws = await req.db.query('SELECT is_demo FROM workspaces WHERE id = $1', [req.user.workspace_id]);
    if (ws[0].is_demo) throw new AppError('The demo workspace keeps a fixed link so reviewers can connect.', 403);
    await req.db.query('UPDATE workspaces SET mcp_key = $1 WHERE id = $2', ['li_' + randomToken(24), req.user.workspace_id]);
    res.json({ ok: true });
  }));
  api.post('/settings/reset-demo', wrap(async (req, res) => { await resetDemo(req.db, req.user.workspace_id); res.json({ ok: true, redirect: '/app' }); }));
  app.use('/api', api);

  // ---------------- errors ----------------
  app.use((req, res) => {
    if (req.originalUrl.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.status(404).send(V.errorPage(404, 'This page does not exist.', req.user));
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err instanceof AppError ? err.status : err.type === 'entity.too.large' ? 413 : err.status === 400 || err.type === 'entity.parse.failed' ? 400 : 500;
    const message = err instanceof AppError ? err.message : status === 413 ? 'Request too large.' : status === 400 ? 'Bad request: the body is not valid JSON.' : 'Unexpected error. Please try again.';
    if (status === 500) console.error(err);
    const json = req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/mcp') || req.method !== 'GET' || (req.headers.accept || '').includes('application/json');
    if (json) return res.status(status).json({ error: message });
    res.status(status).send(V.errorPage(status, message, req.user));
  });
  return app;
}
