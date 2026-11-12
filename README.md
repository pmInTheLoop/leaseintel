# LeaseIntel

**A lease obligations desk for businesses that rent many locations.** Your own Claude reads the lease; LeaseIntel keeps every date and rupee in it live.

**Live demo: https://leaseintel.vercel.app** · Demo login `demo@leaseintel.app` / `leaseintel-demo`

- Claude (the customer's own Claude, via MCP) reads a lease PDF and saves each key term with the exact clause it came from.
- A person verifies each term against its quoted clause, corrects anything wrong, and approves the lease.
- LeaseIntel then calculates, with plain code, every critical date (last day of lock-in, exit notice window, renewal option deadline, escalations, expiry) and a month-by-month rent schedule, and keeps them live for years.
- When an amendment arrives, Claude proposes the changed terms; nothing changes until a person accepts each one.
- Later, Claude reads the live portfolio ("what needs action in 90 days?") and saves the letters it drafts. LeaseIntel never sends anything on its own.

**There is no AI inside LeaseIntel.** No OpenAI, Anthropic, Gemini or other model SDKs, API calls or keys. Dependencies: `express`, `pg`, `@modelcontextprotocol/sdk`, `zod`. The audit is in [docs/ASSIGNMENT_COMPLIANCE.md](docs/ASSIGNMENT_COMPLIANCE.md).

---

## Try it

| What | Where |
|---|---|
| Live app | `https://leaseintel.vercel.app` |
| Demo login | `demo@leaseintel.app` / `leaseintel-demo` |
| MCP link (demo workspace) | `https://leaseintel.vercel.app/mcp/li_demo_volopay_2026` |
| Sample lease PDFs | `https://leaseintel.vercel.app/samples` |

### Connect Claude (2 minutes)

1. In Claude (web, desktop or mobile) open **Settings → Connectors** (some plans: **Customize → Connectors**) → **Add custom connector**.
2. Name `LeaseIntel`, URL = the MCP link above. Leave OAuth fields empty. **Add**.
3. In a new chat, make sure LeaseIntel is switched on in the tools menu.
4. Download `indiranagar-cafe-lease.pdf` from `/samples`, attach it, and type: **"Add this lease to LeaseIntel."**
5. Open the link Claude returns, verify the terms, approve.
6. Back in Claude: **"What needs action in the next 90 days? Draft the renewal notice for the Indiranagar cafe and save it to LeaseIntel."**

Claude Code: `claude mcp add --transport http leaseintel https://leaseintel.vercel.app/mcp/li_demo_volopay_2026`

---

## How it works

```
 Customer's Claude ──(MCP, Streamable HTTP)──▶ /mcp/<workspace-key>
   reads the PDF,                                 │ validates, saves
   writes letters                                 ▼
                                           Postgres (Neon)
                                                  ▲
 Finance team ──(browser)──▶ LeaseIntel web app ──┘
   verifies, corrects, approves,        computes dates + rent schedule (src/engine.js)
   marks deadlines done, edits letters
```

| File | Job |
|---|---|
| `src/engine.js` | Pure date and money arithmetic: lock-in, escalations, tax scope, critical dates, rent schedule, commitments |
| `src/money.js` | Exact decimal arithmetic on BigInt; half-up rounding to each currency's decimals |
| `src/fields.js` | The 23 lease terms tracked, and which are key for approval (some only when they apply) |
| `src/logic.js` | Validation, transactions, verification, approval, amendments, append-only audit trail, read models |
| `src/mcp.js` | 8 MCP tools Claude can call, with schemas and read-only / write annotations |
| `src/app.js` | Express routes: web UI, JSON API, MCP endpoint, sample PDFs; rate limits and same-origin checks |
| `src/views.js` | Server-rendered HTML, small vanilla JS |
| `src/db.js` | Schema, demo seed, Postgres (prod) or PGlite (local/tests), transaction helper |

**MCP tools:** `list_portfolio`, `get_lease` (read-only) · `create_lease`, `update_lease_terms`, `propose_amendment`, `add_location`, `save_document`, `mark_action_done` (write, none destructive).

**Trust rules (enforced in code, not by Claude):**
- Anything Claude writes starts unverified, with the clause it quoted. Claude must quote a clause (or explain why there is none) for every key term it sends.
- Only a logged-in person can verify a term, accept an amendment or approve a lease.
- Approval needs every key term verified. Some terms become key only when they apply: tax scope once a tax rate is set, the lock-in notice policy once there is a lock-in and a notice period, the escalation basis once rent escalates.
- If Claude changes a key term on an approved lease, or a new key term starts to apply, the lease goes back to Needs review.
- Unclear points are never guessed. If the agreement does not say whether tax applies to service charges, totals are marked "not final" and exclude that tax. If it does not say whether exit notice can be served during lock-in, no exit deadline is shown.
- Every change is logged with the old value, new value, who, when, source (Claude, human, amendment) and the reason or clause. The log is append-only: the database ignores UPDATE on it.
- LeaseIntel stores terms and short quotes, not the lease PDF. The PDF stays in the customer's Claude chat.

**Validation:** real calendar dates only (2023-02-29 and 2024-04-31 are refused); whole months only; money up to 2 decimals, percentages up to 4; enums checked. The same rules are in the MCP schema, the app and the database (CHECK constraints).

**Money:** stored as `NUMERIC`, calculated with BigInt, rounded half up to the currency's smallest unit (paise, fils, cents; whole yen). Compounding rounds at each step, as a landlord's invoice would. Currencies are never added together.

**Security model:** passwords hashed with scrypt; session cookie `HttpOnly`, `SameSite=Lax`, `Secure` in production; 14-day sessions, deleted on logout; login and signup rate-limited per IP (per server instance); cookie-authenticated writes rejected if `Origin` or `Sec-Fetch-Site` says cross-site; JSON-only API with size limits; every query scoped to the workspace; all HTML escaped; Content-Security-Policy and frame blocking. MCP access is a secret per-workspace URL (rotatable), **not OAuth**; the demo workspace URL is public on purpose, so never put real data in it.

## Documents

| File | What it is |
|---|---|
| `docs/ASSIGNMENT_COMPLIANCE.md` | Every requirement, how it is met, test evidence, no-AI audit |
| `docs/SAMPLE_LEASE_REFERENCE.md` | Hand-made answer key for the three sample PDFs |
| `docs/PRODUCT_STRATEGY.md` | Customer, problem, pricing, targets, risks |
| `docs/VALIDATION_PLAN.md` | How the price and segment get tested with real buyers |

## Run locally

```bash
npm install
npm start            # http://localhost:3000 (uses in-memory PGlite, no database needed)
npm test             # 57 tests: engine, business logic, sample PDFs, end-to-end over real MCP
```

`PGLITE_DIR=.pglite npm start` keeps local data between restarts. `TEST_DATABASE_URL=postgres://… npm test` runs the suite against real Postgres.

---

## Deploy (Vercel + Neon, about 10 minutes)

1. Push the repo to GitHub and import it in Vercel (framework preset **Other**, no build command).
2. In the Vercel project, **Storage → Create → Neon (Postgres)**. This adds `DATABASE_URL` (use the pooled connection string). Without it the app refuses to start in production.
3. Redeploy. Tables and the demo workspace are created on the first request.
4. Check `/health`: `{"ok":true,"service":"leaseintel","ai_inside":false}`.
5. Use the production domain for the MCP link, not a preview URL (Vercel password-protects previews, so Claude cannot reach them).

Optional env vars: `PUBLIC_URL`, `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_MCP_KEY`.

---

## Known limits (deliberate for v1)

- MCP access uses a secret per-workspace URL, not OAuth. Fine for a pilot; OAuth comes before real customer data.
- Rate limits are in memory per server instance; on serverless each warm instance counts separately.
- Deadlines use the conservative reading of "N months before" (counted back from the last day). A lawyer may read some clauses differently; the person verifying decides.
- No lease accounting (Ind AS 116 / IFRS 16 journals) yet; the rent schedule CSV is the input for it.
- No email/WhatsApp sending, no PDF storage, no OCR, no rent payments.
- Rent-free fit-out periods and one-off compensation are captured as "other clauses", not modelled in the schedule.
- Claude's extraction is tested against hand-written reference tables only through what the app does with a correct extraction; live extraction quality is checked by a person on every lease.

All companies, people, addresses and amounts in the sample leases are fictional.
