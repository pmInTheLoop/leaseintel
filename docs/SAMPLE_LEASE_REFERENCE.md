# Sample lease reference extractions

Written by hand from the text of the three sample PDFs in `/samples` (all fictional), before running the app. They are the answer key for checking what Claude saves. The same values and quotes are in `test/fixtures/samples.js`; `test/samples.test.js` confirms every quote appears word for word in its PDF and that saving it gives the dates and amounts below.

"Review" means a person must make an interpretation call, not just compare a number. A passing test proves the app handles a correct extraction correctly. It does not prove Claude will extract it correctly, which is why a person verifies every key term before approval.

## 1. Indiranagar cafe, Bengaluru (leave and license, INR)

| Field | Expected value | Source | Page | Explicit or ambiguous | Review |
|---|---|---|---|---|---|
| Licensor | Mr. Suresh Gowda | Parties | 1 | Explicit | No |
| Start date | 2018-07-01 | Cl. 2.1 | 1 | Explicit | No |
| Expiry (last day) | 2027-06-30 | Cl. 2.1 "both days inclusive" | 1 | Explicit | No |
| Monthly fee | 1,80,000 | Cl. 3.1 | 1 | Explicit | No |
| Due day | 7 | Cl. 3.2 | 1 | Explicit | No |
| Tax | GST 18%, on fee **and** maintenance | Cl. 3.3 | 1 | Explicit | No |
| Escalation | 15% every 36 months on last paid fee (compound) | Cl. 4.1 | 1 | Explicit | No |
| Security deposit | 10,80,000 | Cl. 5.1 | 1 | Explicit | No |
| CAM | 30,000 per month | Cl. 6.1 | 2 | Explicit | No |
| Lock-in | 36 months from commencement | Cl. 7.1 | 2 | Explicit | No |
| Exit notice | 3 months | Cl. 8.1 | 2 | Explicit | No |
| Notice during lock-in | Only after lock-in ("After the expiry of the lock-in period, either party may terminate...") | Cl. 8.1 | 2 | **Ambiguous**: silent on notice served during lock-in taking effect at its end | **Yes** |
| Renewal option | 60 months, notice 6 months before expiry | Cl. 9.1 | 2 | Explicit | No |
| Other | 45-day rent-free fit-out (2.2); lock-in exit liability (7.1); renewal fee +15% (9.1); sub-licensing needs consent (10.1) | | 1–2 | Explicit | No |

**Computed:** first month 1,80,000 + 30,000 + GST 37,800 = **2,47,800**; rent 2,07,000 from 2021-07-01 and 2,38,050 from 2024-07-01; last month 3,16,299. Last day of lock-in **2021-06-30**; exit notice can be served from 2021-07-01, earliest exit 2021-09-30. Renewal deadline **2026-12-30** (conservative: six months back from the last day).

## 2. HSR Layout cloud kitchen, Bengaluru (lease deed, INR)

| Field | Expected value | Source | Page | Explicit or ambiguous | Review |
|---|---|---|---|---|---|
| Lessor | Mrs. Kavitha Reddy | Parties | 1 | Explicit | No |
| Term | 2025-02-01 to 2030-01-31 | Cl. 2 | 1 | Explicit | No |
| Monthly rent | 95,000, due by the 5th | Cl. 3.1 | 1 | Explicit | No |
| Tax | GST 18% "over and above the rent" | Cl. 3.2 | 1 | Explicit | No |
| Maintenance | None ("No separate maintenance charges are payable") | Cl. 3.2 | 1 | Explicit | No |
| Escalation | 5% every 12 months on rent last payable, first on 2026-02-01 | Cl. 4 | 1 | Explicit | No |
| Advance (deposit) | 5,70,000 | Cl. 5 | 1 | Explicit | No |
| Lock-in | 12 months | Cl. 6.1 | 1 | Explicit | No |
| Exit notice | 2 months, after lock-in | Cl. 6.2 | 1 | Explicit wording "After the lock-in period" | Light |
| Renewal | None ("no automatic right of renewal") | Cl. 7 | 1 | Explicit | No |
| Other | Fire safety certificate yearly (8); utilities at actuals (3.2) | | 1 | Explicit | No |

**Computed:** first month 95,000 + GST 17,100 = **1,12,100**; rents 99,750 / 1,04,737.50 / 1,09,974.38 / 1,15,473.10 (compounded, rounded to the paisa each step). Last day of lock-in 2026-01-31; earliest exit 2026-03-31. No renewal deadline.

## 3. Dubai Marina kiosk, UAE (tenancy contract, AED)

| Field | Expected value | Source | Page | Explicit or ambiguous | Review |
|---|---|---|---|---|---|
| Landlord | Al Noor Marina Holdings LLC | Parties | 1 | Explicit | No |
| Term | 2026-03-01 to 2028-02-29 (leap day) | Cl. 2 | 1 | Explicit | No |
| Rent | AED 14,500 monthly (174,000 a year), due on the 1st | Cl. 3.1 | 1 | Explicit | No |
| Tax | VAT 5% "in addition to rent" | Cl. 3.2 | 1 | Explicit for rent | No |
| VAT on service charges | **Unknown** | Cl. 3.2 and 5 | 1 | **Ambiguous**: contract is silent | **Yes** |
| Escalation | None ("Rent is fixed for the contract period") | Cl. 3.3 | 1 | Explicit | No |
| Deposit | AED 17,400 | Cl. 4 | 1 | Explicit | No |
| Service and marketing charges | AED 1,200 per month | Cl. 5 | 1 | Explicit | No |
| Minimum period | 12 months | Cl. 6 | 1 | Explicit | No |
| Exit notice | 3 months plus one month's rent compensation | Cl. 6 | 1 | Explicit | No |
| Notice during minimum period | **Not specified** | Cl. 6 | 1 | **Ambiguous** | **Yes** |
| Renewal | 12 months, notice no later than 3 months before expiry | Cl. 7 | 1 | Explicit | No |

**Computed:** first month 14,500 + 1,200 + VAT 725 on rent = **AED 16,425**, marked **not final** because VAT on the 1,200 is not stated. Last day of minimum period 2027-02-28; no exit deadline shown until a person records the notice policy. Renewal deadline 2027-11-29.
