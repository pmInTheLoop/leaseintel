# Assignment compliance: LeaseIntel

Source of truth: the Volopay "Product & Tech Assignment" PDF (3 pages) and the recruitment email of 11 Nov 2026.
Status updated 12 Nov 2026. "Pass" means tested with evidence. The app is live at https://leaseintel.vercel.app (Vercel + Neon Postgres).

## A. What the first version must do

| # | Requirement (PDF wording) | Implementation | Evidence | Result |
|---|---|---|---|---|
| 1 | Build a business people would pay for | Lease obligations desk for multi-location tenants; buyers already pay for this category (LeaseGuru lists $999 a year for 10 leases; Leasecake prices per location and pitches "less than 1% of rent") | `PRODUCT_STRATEGY.md`, `BUSINESS_OPPORTUNITIES.md`, evaluation doc with sources | Pass (desk research; no customer interviews yet) |
| 2 | Not a website builder | Lease records, verification, date engine, rent schedule | Product scope | Pass |
| 3 | Not an online shop | No catalogue, cart or payments | Product scope | Pass |
| 4 | "Work from Claude. We type a request in Claude, and something real is created in your app." | Remote MCP server at `/mcp/<workspace-key>`, 8 tools; `create_lease` writes location, lease, term evidence, other clauses and activity in one transaction | `test/e2e.test.js`: "A request in Claude creates a real lease" uses the official MCP client over Streamable HTTP | Pass with the official MCP client; **not yet tested from claude.ai** (needs the deploy) |
| 5 | Claude does the thinking and writing | Claude reads the PDF, extracts terms with quoted clauses, drafts letters; the app only validates and stores | `src/mcp.js` tool contracts; server instructions tell Claude to quote clauses | Pass |
| 6 | "Let a person change it. We can open your app, see what Claude created and change it." | Lease page shows every Claude-written term beside its quote and Claude's doubts; person edits, verifies, approves, accepts or rejects amendment changes, edits letters, marks deadlines done | e2e: "A person opens the app…", "The person corrects a wrong term…", "Amendment: Claude proposes…"; screenshots of the rendered pages | Pass |
| 7 | Changes persist beyond the conversation | Postgres (Neon in production); every change logged in an append-only `activity` table with old and new values | e2e: "Data survives a full restart"; Claude reads the person's corrections back (`corrected_by_person: true`) | Pass (local tests; live on Neon: a lease created by Claude on 11 Nov was still there, edited and reviewed, on 12 Nov) |
| 8 | "Be live on the internet, so we can try it ourselves." | Vercel serverless + Neon Postgres; README deploy steps | `https://leaseintel.vercel.app/health` returns `{"ok":true,"ai_inside":false}` (checked 12 Nov) | Pass |
| 9 | "Have no AI inside. No OpenAI, Anthropic or other AI keys anywhere in your app." | Dependencies: express, pg, @modelcontextprotocol/sdk, zod (+ PGlite for local tests). No model calls, no keys, no outbound HTTP from the server | Audit below | Pass |
| 10 | Keep it small: one thing that works well | One workflow: lease → verified terms → live dates and rent → amendments → letters | 57 passing tests | Pass |

## B. What to submit

| # | Requirement | Prepared | Result |
|---|---|---|---|
| 11 | Pitch video, 5 minutes or less | Shared as a link in the submission | See submission |
| 12 | Link to live app + test username and password | `demo@leaseintel.app` / `leaseintel-demo` (also pre-filled on the login page) | Pass (logged in on the live site, 11 and 12 Nov) |
| 13 | MCP link + simple steps to connect it to Claude | `https://leaseintel.vercel.app/mcp/li_demo_volopay_2026`; steps in README, on `/connect`, and in the email | Pass (connected from claude.ai; Claude created the Indiranagar lease on the live site) |
| 14 | Video covers: who you are 45s, best work 30s, why this wins 1m, demo 2m, the money 45s | Shown in the video: who I am, best work, why this wins, a live demo (type in Claude, it appears in the app, edit it), and the money | See submission |
| 15 | Within 24 hours (deadline 12 Nov 2026, 9:30 AM IST) | Code, tests, docs done 11 Nov | Submitted a little late (explained in the email) |

## C. No-AI audit (rerun 11 Nov 2026 after the quality pass)

```
$ grep -rniE "openai|anthropic|@ai-sdk|gemini|generativelanguage|cohere|mistral|groq|huggingface|replicate|ollama|langchain|llamaindex|api\.anthropic|api\.openai|sk-[a-z0-9]|_API_KEY|claude-" src api package.json vercel.json
src/app.js:19: { file: 'dubai-marina-kiosk-lease.pdf', ... }      ← false positive: "kio-sk-l" matches the key pattern sk-…
$ ls node_modules | grep -iE "openai|anthropic|ai-sdk|gemini|langchain|cohere|mistral|groq|huggingface|replicate"
(none)
$ grep -rnE "fetch\(|https?\.request|axios" src api
src/views.js:59  browser-side fetch to the app's own /api (same origin)
dependencies: @modelcontextprotocol/sdk, express, pg, zod   devDependencies: @electric-sql/pglite
```

Environment variables used: `DATABASE_URL` (or `POSTGRES_URL`), `PUBLIC_URL`, `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_MCP_KEY`, `LOGIN_RATE_MAX`, `SIGNUP_RATE_MAX`. None are AI credentials. `LEASEINTEL_TEST_HOOKS` exists only for the rollback test.

## D. Test results (11 Nov 2026, executed, not just written)

`npm test` → **57 passed, 0 failed** on PGlite, and **57 passed, 0 failed** against a Postgres wire-protocol server using the same `pg` driver as production (`TEST_DATABASE_URL=… npm test`).

| File | Tests | What it proves |
|---|---|---|
| `test/e2e.test.js` | 13 | Real server process + official MCP client: 8 tools with schemas and annotations; refused bad input writes nothing; Claude creates a lease; person sees quotes and Claude's flags, cannot approve early, corrects 5% → 15% with a reason, verifies, approves; Claude reads the change and saves a letter (escaped); Claude's key-term change reopens review; amendment accept/reject recalculates; security (bad key, forged session, bad JSON, 1 MB+ body, cross-site Origin, other workspace, cookie flags); restart persistence, CSV, PDFs; logout and rate limit; production refuses to start without a database; demo reset |
| `test/engine.test.js` | 21 | Strict dates, month-end and leap years, negative offsets, lock-in last day vs first day after, three notice policies, compound vs base vs explicit first escalation, no escalation, tax on rent only / rent + charges / unknown, exact money and rounding (INR, SGD, JPY), future and expired leases, one change updating every dependent number |
| `test/logic.test.js` | 17 | Validation, required evidence, failed create rolls back every write, outer transaction rollback, duplicate guard, conditional key terms, reopen rules, before/after audit rows, append-only log, stale action keys, idempotent letters, amendments (accept, reject, stale), workspace isolation, per-currency totals |
| `test/samples.test.js` | 6 | Every reference quote appears word for word in its PDF; saving each reference extraction gives the expected dates, amounts and warnings |

What the tests do **not** prove: that Claude extracts these values from the PDFs. That is checked live in your own Claude, and a person verifies every key term before approval.

## E. Post-deploy checks

Checked on the live site: health endpoint, demo login, the claude.ai custom connector creating a lease through MCP, and the data persisting in Neon.
