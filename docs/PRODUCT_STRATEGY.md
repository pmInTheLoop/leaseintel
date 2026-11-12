# Product strategy: LeaseIntel

**One line.** A lease obligations desk for businesses that rent many locations. The customer's own Claude reads each lease; LeaseIntel turns it into verified terms, a live calendar of deadlines and a rent schedule finance can pay from.

## What are we building?
A web app plus a remote MCP server. A finance or expansion lead attaches a lease PDF in Claude and says "Add this lease to LeaseIntel". Claude extracts up to 23 terms, each with the clause it came from. A person checks each term against its quote in LeaseIntel and approves. LeaseIntel then calculates the last day of lock-in, when exit notice can be served, the renewal option deadline, every escalation and expiry, plus a month-by-month rent schedule with tax applied only where the agreement says, and keeps them live for the life of the lease. When an amendment arrives, Claude proposes the changed terms and a person accepts or rejects each one. Later, Claude reads the live portfolio to answer "what needs action?" and saves the letters it drafts.

## Who is the first customer?
The finance controller or head of expansion at an Indian chain with **10 to 60 rented locations**: cafes and QSRs, salons, clinics, pharmacies, coaching centres, cloud kitchens. Big enough that leases are a spreadsheet problem; small enough that one person decides and enterprise lease software is overkill.

## What painful problem are we solving?
Each lease hides money and dates across 20 to 60 pages. Indian commercial leases commonly run 3 to 9 years with escalations every 12 months or every 3 years, a lock-in, notice periods and a renewal window. Miss the renewal notice and the option can lapse; miss an escalation and the landlord's invoice goes unchecked; miss the lock-in end and an unprofitable store keeps paying rent. Today this lives in Excel and people's memory.

## Why will customers pay?
Because the downside is measured in lakhs per location: a lapsed renewal option at a good site, an overcharged escalation for months, or rent paid through a lock-in nobody tracked. Buyers already pay for this category (LeaseGuru lists $999 a year for 10 leases on Capterra and GetApp; Leasecake prices per location on request and says it "costs less than 1% of rent", checked 12 Nov 2026). Willingness to pay at our price is a hypothesis until tested with 10 finance leads.

## Main competing alternative
Excel plus calendar reminders. Then: enterprise lease software (Visual Lease, LeaseQuery, MYNDLeaseX, PwC Lease Fix) and US tools for multi-unit tenants (Leasecake).

## Why our approach is better for this customer
- **Setup in minutes, not a project.** Claude does the abstraction that other vendors sell as a paid service or a 2 to 3 month onboarding.
- **Trust by design.** Every term shows the exact clause; nothing is approved until a person verifies it; changes by Claude after approval send the lease back for review.
- **No AI cost.** The customer's Claude plan pays for reading; we can price at a fraction of enterprise tools.
- **Built for Indian lease habits**, with multi-currency for the Gulf and Southeast Asia.

## Why the app must exist beyond Claude
A Claude chat ends; a lease runs for 9 years. Deadlines must be computed exactly (Claude should not do date arithmetic for a legal deadline from memory), shown to people who were not in the chat, verified by a named person, and kept with an audit trail. The rent schedule must be exportable to whoever pays rent.

## How this fits Volopay
Volopay sells spend management to finance teams: cards, expenses, accounts payable (vendor management, invoice approvals, payment automation), multi-currency transfers and accounting sync (Volopay site, checked 11 Nov 2026). LeaseIntel sits one step before bill pay, for the same buyer.

| LeaseIntel produces | Where it lands in a spend platform |
| --- | --- |
| Verified monthly rent + CAM + GST per location | Recurring vendor payments to landlords in AP / bill pay |
| Escalation dates and new amounts | The month a scheduled payment must change, and a check on the landlord's invoice |
| Security deposits by location | Cash held by vendors, for the CFO's view of working capital |
| Leases in INR and SGD | Volopay's home markets (Singapore-based; India is a live market) |
| Commitments until lock-in end and expiry | Committed spend for budgeting and forecasting |

**What is fact and what is an idea.** Fact: the modules above are on Volopay's site, and rent is a recurring vendor payment for every chain. Idea (not built, not discussed with Volopay): a "rent" payee type fed by LeaseIntel's approved schedule, so rent payments update themselves when an escalation date passes. Today the bridge is the CSV export.

**Why this matters as a business.** Rent is one of the largest fixed costs a chain has, and our assumption (to test in customer calls) is that it is often paid by manual bank transfer outside the spend platform. A verified schedule is a reason to bring that spend into the platform.

## Smallest complete MVP (built)
Login and workspaces; locations; leases with 23 tracked terms and quoted evidence; Claude's ambiguity flags; verify, correct and approve; conditional key terms (tax scope, lock-in notice policy); date engine and rent schedule with contract-specific tax; amendment proposals with accept/reject; portfolio with 90-day action list and per-currency totals; letters and memos; append-only activity log with old and new values; CSV export; 8 MCP tools; sample leases; demo reset. 57 automated tests.

## Deliberately not building yet
AI inside the app; OCR; storing PDFs; OAuth for MCP (next before real data); Ind AS 116 / IFRS 16 journal entries; landlord-side features; paying rent; sending emails or WhatsApp; ERP or Volopay integrations.

## Business model
SaaS per location: **₹399 per location per month** in India, **$6 per location per month** elsewhere. A 25-location chain pays about ₹1.2 lakh a year. Later add-ons: Ind AS 116 schedules, landlord-invoice checks, rent payment through partners.

**Infrastructure cost (estimate, not total cost to serve).** No AI cost, because the customer's Claude does the reading. Hosting is shared: Vercel Pro $20/month plus Neon Postgres usage (typically about $15/month at small scale), about $35/month in total, roughly ₹30 per customer per month at 100 customers.

**Wider cost to serve (not yet estimated with data).** Onboarding help on the first leases, support, founder-led sales time, backups and point-in-time recovery, monitoring and alerting, a security review before customer data (OAuth, penetration test), and payment processing fees. These, not hosting, will set the real margin; they are unknown until the first pilots.

## First 100 customers
1. **Free lease health check** for chains: "Send 3 leases, see your next 12 months of deadlines and rent steps in a day." It costs us almost nothing to run because the customer's Claude (or ours, for the sales demo) does the reading.
2. **CA firms** that already do Ind AS 116 and audits for these chains, as referral partners.
3. **Founder-led outreach** to finance controllers and expansion heads at 10 to 60 location brands in Bengaluru, Pune and Mumbai.
4. **Distribution with a spend platform**: rent is a recurring vendor payment, so a partner like Volopay has the same customers.

## Targets (not forecasts)
- **1 year:** 100 paying chains × 20 locations × ₹399 × 12 = **₹95.76 lakh ARR**. Accounting export live.
- **3 years:** 1,000 chains × 25 locations × ₹399 × 12 = **₹11.97 crore ARR**, before any payment or accounting add-ons.

These are targets to test against, built from an unvalidated price. See `VALIDATION_PLAN.md`.

## Biggest risks
1. Extraction errors on scanned or messy leases → human verification is mandatory and enforced.
2. Crowded category → narrow wedge (mid-size Indian chains) and speed of setup.
3. Buyers may want accounting first → be ready to start from the Ind AS 116 schedule.
4. Sales cycle to chains → start where one finance lead decides.
5. Secret-URL MCP auth → move to OAuth before real customer data.
