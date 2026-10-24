# CLAUDE.md — Autonomous Procure-to-Pay Desk for a Drone Maker (Hyphenate track)

Built at **Cal Hacks 13.0** (Oct 23–25, 2026). All code must be written during the event.
**Submission: Devpost by Sunday 9:00 AM.** Live demo at judging 10:30 AM–12:30 PM. Judges may ask us to run a scenario of their own.

**Primary target: Hyphenate — "The Hyphenated Enterprise: Autonomous Systems for Finance"** ($8,000 / $5,000 / $3,000; expedited interviews for top 5).
Also entered: Anthropic, Microsoft, Apify/Bright Data (optional). Convex optional.

Hyphenate's brief: *pick a company and one corner of its finance team — a few seats that work closely together — then build the autonomous system you'd hire to fill them, and the company it works in: the software it uses, the people it answers to, and the mistakes hiding in its data. Be imaginative about the company and strict about how it works underneath.*

---

## 1. The product

**Company:** **Kestrel Aerial** (fictional), a US maker of mapping and firefighting-support drones, **~$137M revenue** (FY2025 actual $128.4M; ~420 employees). Sells to federal agencies (~40%), state/local fire departments (~35%) and commercial operators (~25%), so **component country-of-origin compliance affects revenue**. Builds **~300 units/month of one model (Kestrel K2, ASP ~$32,000)** plus fleet-software and support revenue (~$22M/yr). The K2 has **15 purchased parts (~$13.3k/unit)** from **6 suppliers** (~$4M/month direct materials). Profile in `data/company.json`; revenue enters the books as monthly sales summaries at close (outside the desk's seats). "Revenue at risk" = federal share × affected units × ASP.

**Judges' requirement (Oct 23 workshop):** company > $100M revenue, and agents that **learn, run, escalate, and improve** — learning from the company's own history as internal rules (§7a).

**The finance corner:** procure-to-pay plus inventory accounting — buying parts, receiving them, matching invoices, paying suppliers, valuing inventory, closing the month.

**The company model ("ontology"):** every business object lives in one linked graph — `Product → BOM line → Part → Supplier → Contract → PO → Receipt → Invoice → Payment → Journal Entry`, plus `Inventory lot`, `Customs entry`, `Compliance record`. Every agent reads from it and writes requests back into it. The UI shows this as a clickable **Company Map**, and every decision links to the exact objects it used.

### Seat one-liner (first line of README, first line of the pitch)
**"It fills three seats on Kestrel's procure-to-pay desk — buyer, AP clerk, and inventory accountant — with read-only access to the books, no approval rights, an append-only audit trail, and it escalates to the controller anything material, non-compliant, or uncertain."**

| Seat (agent) | Does | Can request | Cannot |
|---|---|---|---|
| **Buyer** | Watches inventory vs. production plan, proposes POs, chooses suppliers from scorecards, flags supply risk (export restrictions, single-source parts) | PO, supplier switch, expedite | approve POs; pay; change vendor master |
| **AP clerk** | Three-way match (PO ↔ receipt ↔ invoice), landed-cost check on customs/broker invoices, compliance check on what was actually shipped, schedules payments, holds mismatches, verifies remittance changes | payment, payment hold, debit memo | approve its own payment requests; change bank details |
| **Inventory accountant** | Values inventory (standard cost + variances), books GRNI accruals (goods received not invoiced) at month end, reverses them, books price/FX variances, return credits | journal entries | post without controller approval; post to a locked period |

**People (model-played personas, §8):** **Dana (Controller)** approves; **Raj (Procurement Manager)** sometimes overrides supplier choice; **Mei (Engineering lead)** must approve any part substitution; **Luis (Receiving dock)** enters receipts, sometimes wrong; supplier contacts send emails (some legitimate, one fraudulent).

### Named community (Anthropic track)
Controllers and finance leads at mid-market US hardware manufacturers ($100M–$500M revenue) who sell to government customers.

---

## 2. How we answer Hyphenate's judging

| Question | Our answer |
|---|---|
| **Is it real enough?** | Real **US Harmonized Tariff Schedule** duty rates for the parts' HTS codes, real **FX rates**, real **SEC EDGAR** financial data for public suppliers in the scorecard, deterministic matching/costing/ledger math with tests, planted errors with an **answer key + scorecard**; optional run on a public invoice benchmark (§11). |
| **Would you hire it?** | Three named seats, permission table, segregation of duties enforced in code, materiality thresholds, compliance gates, append-only audit trail, escalates when unsure, respects overrides. **Learns Kestrel's unwritten internal rules from 14 months of company history**, with evidence, and gets measurably better (fewer escalations, same catch rate). |
| **Something new?** | Compliance-aware procure-to-pay for a government-facing hardware maker, on a live company graph: the AP check isn't just "does the invoice match" but "does what we received keep us eligible to sell." |
| **The moment** | **(1)** A supplier quietly ships a cheaper substitute part whose paperwork shows a restricted origin; AP catches it during matching, holds payment, flags government-contract revenue at risk, routes to engineering + controller. **(2)** Invoice says $132/motor, contract says $118 — $42,000 held and defended with the contract clause. **(3)** Bank-detail change email the day before a large payment — held, and the agent cites the rule it learned from Kestrel's own 2025 near-miss. **(5)** "It learned how Kestrel works": rules mined from history, approved by Dana, escalations per month falling while catch rate stays 100%. **(4)** Export restriction hits a critical part — buyer shows 8 weeks of cover, switches to backup supplier; accountant books the cost impact. |

### Their "what makes it hard" — where we handle each

| Hard part | Where |
|---|---|
| **Sources that disagree** | PO vs. receipt vs. invoice vs. contract vs. customs entry vs. certificate of origin vs. bank. Each has a declared **system of record** role (§5); agents must say which they trust and why. |
| **Time** | Month-by-month simulation with memory: open POs across months, GRNI accruals and reversals, defect found in May → return → supplier credit in July, scorecards that shift who gets the next PO, mid-contract price change → variance, locked periods (§7). |
| **Working with others** | Dana delays/rejects/asks why; Raj overrides supplier choice; Mei must approve substitutions; Luis's wrong receipt quantity; a half-finished payment batch from a previous clerk (§8). |
| **Limits** | Requester ≠ approver, enforced in `lib/controls.ts`; no agent can approve, pay, or edit vendor/bank data (§9). |
| **Explainable & accountable** | Audit trail + "Why?" panel = a path through the Company Map to the data, rule, or person behind each call (§9). |

Use their vocabulary everywhere: **three-way match, GRNI, materiality, segregation of duties, audit trail, system of record, reconciliation, period close, journal entry, subledger, controller.**

---

## 3. Scope rules (read before writing code)

- **Cut hard:** one product, 15 parts, 6 suppliers, 3 seats, 6–8 simulated months. Depth over breadth.
- **The LLM never does arithmetic.** Matching tolerances, landed cost, duty, FX, inventory valuation, variances, accruals, ledger postings are deterministic TypeScript with tests.
- **No agent can approve, pay, post, or edit master data.** Agents create requests. Only approval by `controller` (Dana or a human in the UI) moves money or books entries. Engineering approval is additionally required for substitutions.
- **Compliance rules are data, not hardcoded claims.** Represent them as a configurable `CompliancePolicy` (list of restricted origins/manufacturer categories per component class, customer types it applies to). Seed it with a policy *modeled on* US restrictions on foreign-made drone components for federal purchases (e.g. the American Security Drone Act and related defense authorization provisions). **Do not state legal specifics in the UI as fact**; label it "Policy modeled on federal drone component restrictions — verify with counsel." Put sources in `docs/compliance-sources.md` once verified.
- **Real data with fallback:** every external fetch is cached to `data/cache/`; the demo must work offline from cache.
- No real ERP install (Odoo/ERPNext are too heavy). We build a small ERP-style data model ourselves.

---

## 4. Stack

- **Next.js (App Router) + TypeScript + Tailwind**, **Vitest**.
- **Convex** (local deployment, no account: `npx convex dev` → run locally; offline after first download) for state, audit trail, approval queue, learned rules (realtime). Engines stay pure TS so storage is swappable. Fallback: SQLite + polling if Convex blocks >30 min.
- **Ledger:** our own double-entry ledger in `lib/ledger/` with hard invariants (balanced JEs, locked periods, reversing entries only); **Beancount export** (`scripts/export-beancount.ts`) so books open in Fava.
- **Anthropic API** (`@anthropic-ai/sdk`), model `claude-sonnet-5-5`, tool use for agents, personas, and document extraction (invoices, packing slips, certificates of origin).
- **Company Map:** React Flow (or d3) graph view of the ontology.
- **External data (verify each works Friday night; cache everything):**
  - **HTS duty rates** — USITC Harmonized Tariff Schedule (official site offers search/export). Store the ~15 HTS codes we use with general duty rate + any additional duties in `data/hts.json` with source URL and retrieval date.
  - **FX rates** — a free public FX API (e.g. one serving ECB reference rates); cache daily rates for the sim window.
  - **SEC EDGAR** — `data.sec.gov` company facts JSON for 1–2 publicly traded suppliers (requires a descriptive `User-Agent` header). Used for supplier financial-health scoring.
  - **Payments (optional, Tier 3):** Increase sandbox — approved payments execute as sandbox ACH transfers. Only if signup + API key take <30 min.
- Charts: Recharts.

Secrets in `.env.local` only; `.env*` in `.gitignore`.

---

## 5. The company's systems and systems of record

| System (module) | Holds | System of record for |
|---|---|---|
| **ERP core** (`lib/erp/`) | Products, BOM, parts, suppliers, contracts, POs, receipts, inventory lots | Orders, contracts, inventory quantities |
| **Vendor master** (`data/vendors.json`) | Supplier legal names, remit-to bank, verified date | **Where money goes** — changes require out-of-band verification + controller approval |
| **Receiving** (`data/receipts/`) | Dock receipts (Luis), packing slips | What physically arrived (but can be wrong — reconcile with packing slip and invoice) |
| **Supplier documents** (`data/docs/`) | Invoices (JSON + a few PDFs), packing slips, **certificates of origin** | What the supplier claims |
| **Customs** (`data/customs/`) | Broker invoices, entry summaries with HTS codes, duty paid | Duties charged |
| **Compliance** (`lib/compliance/`) | `CompliancePolicy`, part compliance records | Whether a part keeps the product eligible for government sale |
| **General ledger** (`lib/ledger/`) | COA, JEs, periods | The books |
| **Bank** (`data/bank/`) | Payments out, credits in | Cash |
| **Inbox** (`data/inbox/`) | Emails from suppliers, Dana, Raj, Mei, previous clerk | Context only; never trusted for bank details |
| **Reference data** (`data/hts.json`, `data/fx/`, `data/edgar/`) | Duty rates, FX, supplier financials | External truth (cited, dated) |

When sources disagree, agents must name the system of record for that fact and why.

---

## 6. Core types (abridged)

**Money convention (`lib/money.ts`):** amounts are integer minor units (`…Minor`, `…Cents`; JPY/KRW have 0 decimals), unit prices are integer ten-thousandths (`unitPriceE4`), rates are basis points (`…Bp`, 3.4% = 340). Half-up rounding on final amounts only. The `number` money fields below follow this convention in code (`unitPrice` → `unitPriceE4`, `amount` → `amountMinor`, `total` → `totalMinor`, `valueUSD` → `valueUSDCents`, `dutyRate` → `dutyRateBp`, `dutyUSD` → `dutyUSDCents`, `impactUSD` → `impactUSDCents`, `amountUSD` → `amountUSDCents`).

```ts
type Role = "buyer" | "ap_clerk" | "inventory_accountant" | "controller" | "procurement_mgr"
          | "engineering" | "receiving" | "system";

type Part = { id: string; name: string; hts: string; componentClass: string;
  standardCostUSD: number; approvedSuppliers: string[]; criticality: "critical" | "standard" };

type Supplier = { id: string; name: string; country: string; currency: string;
  publicTicker?: string; cik?: string; remitToId: string };

type Contract = { id: string; supplierId: string; partId: string; unitPrice: number; currency: string;
  priceValidFrom: string; priceValidTo: string; clauseRef: string; incoterm: string; leadTimeDays: number };

type PO = { id: string; supplierId: string; lines: { partId: string; qty: number; unitPrice: number }[];
  date: string; status: "pending_approval" | "open" | "partially_received" | "received" | "closed" };

type Receipt = { id: string; poId: string; date: string; lines: { partId: string; qty: number; lot: string }[];
  enteredBy: "receiving"; packingSlipRef?: string };

type Invoice = { id: string; supplierId: string; poId?: string; date: string; currency: string;
  lines: { partId?: string; description: string; qty: number; unitPrice: number; amount: number;
           countryOfOrigin?: string; manufacturerPartNo?: string }[];
  total: number; remitTo?: string; sourceFile: string; simulated: true };

type CertificateOfOrigin = { id: string; invoiceId: string; partId: string; manufacturer: string;
  countryOfOrigin: string; sourceFile: string };

type CustomsEntry = { id: string; invoiceId: string; lines: { hts: string; valueUSD: number; dutyRate: number; dutyUSD: number }[];
  brokerFeeUSD: number; total: number };

type Case = { id: string; kind: CaseKind; openedPeriod: string; status: CaseStatus;
  impactUSD: number | null; confidence: number;
  evidence: { objects: string[]; calcSteps?: CalcStep[]; quotes?: string[]; sources?: string[] };
  history: { at: string; actor: Role; event: string; refs: string[] }[] };

type CaseKind = "price_variance_vs_contract" | "qty_mismatch" | "duplicate_invoice"
  | "noncompliant_substitution" | "duty_overcharge" | "remittance_change_unverified"
  | "export_restriction_exposure" | "defect_return" | "fx_variance" | "grni_accrual"
  | "unknown_supplier" | "missing_document" | "source_disagreement";

type Request = { id: string; kind: "po" | "payment" | "payment_hold" | "debit_memo" | "journal_entry"
  | "supplier_switch" | "substitution_approval" | "vendor_change";
  requestedBy: Role; requiredApprovers: Role[]; approvals: { by: Role; decision: "approve" | "reject"; reason: string; at: string }[];
  amountUSD?: number; caseId?: string; payload: unknown; status: "pending" | "approved" | "rejected" | "expired" };

type CalcStep = { label: string; inputs: Record<string, number | string>; result: number; ruleRef: string };
```

Audit trail is append-only. JEs are never edited — only reversed.

---

## 7. Time: month-by-month simulation

`simulation/clock.ts` advances simulated days; month-end runs close. State persists (Convex).

**Required cross-month behaviors (each is a test):**
1. **GRNI:** parts received in late March, invoice arrives April → accrual at March close, reversal + actual in April, difference explained.
2. **Defect → return → credit:** Mei flags a defective lot in May → AP requests debit memo / return → supplier credit appears on July invoice → matched to the May case, closed.
3. **Scorecard drift:** a supplier's late deliveries and invoice errors over Mar–May lower its score; the buyer's June PO goes to the alternate supplier (unless Raj overrides — then respect it and note it).
4. **Mid-contract price change:** contract amendment effective May 1; invoices after that date must use the new price; invoices before must not.
5. **Remembered rejection:** Dana rejects a $640 variance as immaterial in April; not re-raised in May/June.
6. **Export restriction:** news item in June restricts a material used in Part P07 → buyer computes weeks of cover from inventory + open POs vs. production plan → proposes switch to backup supplier → accountant books the cost impact when the new PO is approved.
7. **Locked periods:** corrections after close post in the current period with a memo referencing the original.

UI: timeline bar with month slider, "Run next day / next month", period status.

### 7a. Learning: internal rules from company history

Kestrel has 14 months of history before the sim (Jan 2025–Feb 2026) in `data/history/` at **exception-log level**: past AP exceptions with the decision and Dana's free-text reason, incidents, dated policy memos, and monthly volumes per supplier (amounts in USD as booked; no customs math in history). The desk **mines it for Kestrel's unwritten internal rules**, applies approved rules while it runs, escalates what no rule covers, and improves rules as new decisions arrive.

- **Rule language** (`lib/rules/`, deterministic): scope (supplier, part, finding kind, amount range, currency, date range) → action (`info` | `require_check` | `route_to(role)` | `escalate`). Support, counterexamples, confidence and thresholds are computed in code; the LLM only extracts conditions from Dana's reasons and drafts the rule statement.
- **Lifecycle:** proposed → approved / rejected → in review (when a counterexample or override arrives) → retired. Every rule cites the history events behind it.
- **Guardrails:** never learnable — compliance, bank/remittance, segregation of duties, locked periods, duplicate payments. Tightening rules apply on proposal; loosening rules need Dana's approval and only reach below-materiality items. A suppressed finding is still logged with the rule id in its "Why?" panel — improvement means fewer escalations, never fewer findings.
- **History fights back:** decoys (low-support patterns that must not become rules), a counterexample that lowers confidence, drift (a threshold changed by a dated memo — recency wins), and a trap (Dana once approved an emailed bank change → near-miss; the rule to learn is "callback required", not "approve bank changes"). Hidden rules and their parameters vary by seed and live only in the answer key.
- **Improvement in the sim:** one in-sim override sends a rule to review; one new rule emerges mid-sim (the recurring broker misclassification, #6). Scored: rule discovery precision/recall vs. hidden rules (decoys included), escalations per month cold vs. with memory, catch rate unchanged.
- **Test:** applying the hidden rules as approved rules to the sweep yields exactly the key's expected escalations and suppressions, and no rule ever swallows #1, #2, #5 or #13.

---

## 8. People (model-played personas)

`simulation/people.ts`. Each persona is a separate Claude call with its own prompt and **seeded, scripted key decisions for the demo run** (so they behave predictably in front of judges), plus a free mode for judges.

- **Dana (Controller):** approves/rejects with reasons; slow sometimes (agent reminds at day 3, escalates at day 5); rejects variances < $1,000 materiality; asks "why?" on the noncompliant-substitution hold and the $14 vs $11 dispute.
- **Raj (Procurement Mgr):** overrides one supplier choice for relationship reasons → buyer complies and records the override.
- **Mei (Engineering):** must approve any part substitution; rejects the noncompliant substitute; flags a defective lot in May.
- **Luis (Receiving):** enters 660 instead of 600 on one receipt → AP finds the disagreement with the packing slip and invoice, asks Luis to recount before paying.
- **Previous AP clerk (handoff):** inbox note: "paid Northwind and Atlas, still need the other 4, one invoice looked off" → AP resumes without double-paying.
- **Fraud email:** "Atlas Motors" asks to change remit-to bank the day before a large payment (~$355k: the corrected April invoice) → AP holds, never edits vendor master, escalates to Dana.

A **"Play the controller"** toggle lets a judge make Dana's decisions live.

---

## 9. Agents, permissions, controls

One agent loop per seat (`lib/agents/{buyer,ap,inventory}.ts`), own system prompt, **only its own tools**. A coordinator (plain code, not an LLM) runs them each sim day.

### Tools by role

| Tool | buyer | ap_clerk | inventory |
|---|---|---|---|
| Read company graph / docs / inbox / ledger / reference data (read-only) | ✓ | ✓ | ✓ |
| `three_way_match`, `landed_cost`, `fx_convert`, `value_inventory`, `compliance_check` (deterministic) | ✓ | ✓ | ✓ |
| `extract_document` (invoice, packing slip, certificate of origin → typed object, low-confidence fields flagged) | | ✓ | ✓ |
| `open_case`, `add_case_note`, `message(role, text)`, `escalate(reason, refs)` | ✓ | ✓ | ✓ |
| `request_po`, `request_supplier_switch` | ✓ | | |
| `request_payment`, `request_payment_hold`, `request_debit_memo`, `request_substitution_approval` | | ✓ | |
| `request_journal_entry` | | | ✓ |

No tool approves, pays, posts directly, or edits the vendor master. Posting/payment happens in `lib/ledger/post.ts` / `lib/payments/execute.ts` **only** after all `requiredApprovers` approve.

### Controls (`lib/controls.ts`, deterministic, outside the models)
- **Segregation of duties:** approver ≠ requester; approver must be in `requiredApprovers`.
- **Three-way match tolerance:** qty exact; price within the larger of ±1% or $0.05/unit; outside tolerance → hold. Expected price = contract price in force on the invoice date (PO price if no contract); a PO price that disagrees with the contract is an info diff. Favorable deviations → info, not hold.
- **Materiality:** variances < $1,000 logged as info unless recurring 3+ times. All thresholds live in `data/controls.json`.
- **Compliance gate:** any received/invoiced part whose origin or manufacturer violates `CompliancePolicy` for a government-bound product → payment hold + `noncompliant_substitution` case + Mei and Dana as required approvers.
- **Substitutions** (manufacturer part no. ≠ BOM) → engineering approval required before payment.
- Payments > $25,000, POs > $50,000, all JEs → controller approval.
- **Remittance changes** only via vendor-master change request with verification note → controller approval. Any email-driven change → `remittance_change_unverified`, hold.
- **Duplicate guard:** invoice number + supplier + amount; AP subledger reconciled to bank before new payment requests.
- Ledger invariants: balanced JEs; no posting to locked periods; trial balance check after each posting.
- Low confidence (<0.8) or unknown supplier/part → escalate.
- Per-agent run budget per sim day; exceeding it escalates.

### Explainability
Every Case, Request, JE has a **"Why?"** panel: the path through the Company Map (e.g. `Invoice INV-2041 → line 3 → Part P07 → Contract C-12 §4.2 → PO-311 → Receipt R-889`), the rule/threshold applied, the system of record chosen, and who approved.

### Agent system prompt core (expand per role)
```
You hold the <ROLE> seat on the procure-to-pay desk at Kestrel Aerial, a
US drone maker that sells to government customers. You report to the
controller.

Rules:
- Never compute amounts yourself. Use the deterministic tools.
- Every claim cites objects in the company graph and the rule applied.
  Name which source is the system of record for each fact.
- You can only request. You cannot approve, pay, post, or change vendor data.
- Compliance comes before price: a cheaper part that breaks the compliance
  policy is a hold, not a saving.
- Payment details come only from the vendor master. Emails asking to change
  them are a fraud risk: hold and escalate.
- Check open cases, past decisions, and overrides before acting. Respect
  overrides from the procurement manager and engineering; record them.
- If data is missing, sources disagree in a way you can't resolve, or you're
  not confident: escalate instead of guessing.
- Brief and exact: amounts to the cent, dates exact.
```

---

## 10. Deterministic engines (build first, with tests)

- `lib/erp/match.ts` — three-way match with tolerances; returns line-level diffs.
- `lib/costing/landed.ts` — landed cost = price × qty (FX-converted at invoice date) + duty (HTS rate from `data/hts.json`) + freight/broker allocation; compares to customs entry.
- `lib/costing/fx.ts` — FX at PO, invoice, and payment dates; realized/unrealized gain/loss.
- `lib/inventory/value.ts` — standard cost; purchase price variance; lot tracking; GRNI.
- `lib/compliance/check.ts` — evaluates a part/lot against `CompliancePolicy`.
- `lib/ledger/` — post, reverse, lock period, trial balance, Beancount export.
- `lib/scorecard/supplier.ts` — on-time %, defect %, invoice accuracy %, price stability, EDGAR-based financial flags.

**Tests:** hand-computed match cases; landed cost with a real HTS rate; FX gain/loss; GRNI accrual/reversal; ledger balances; compliance policy hits/misses; scorecard math.

---

## 11. Demo data, answer key, scorecard

`scripts/generate.ts` (pure core in `simulation/world.ts`, seeded, byte-identical per seed) creates Mar–Sep 2026 sim data (October excluded: ECB rates for late October don't exist before judging, and rates are never invented): production plan, BOM consumption, POs, receipts, invoices (JSON; the 3 PDFs are deferred until a PDF dependency is approved), packing slips, certificates of origin, customs entries, bank, inbox.

**Agents' read tools must never expose `data/answer_key.json`** (or `simulation/`); only the scorer reads it. `simulation/sweep.ts` is the deterministic baseline: its findings must equal the key exactly (tested for two seeds).

**Planted problems → `data/answer_key.json` (site/part/supplier, period, kind, expected impact, expected handling):**
1. **Noncompliant substitution** — Supplier Vireo ships a cheaper flight controller (P04) whose certificate of origin shows a restricted origin; invoice description differs from BOM part number. *(Headline moment.)*
2. **Price vs. contract** — Atlas invoices $132.00/motor vs. $118.00 contract (C-12 §4.2), 3,000 units → $42,000.
3. **Remittance-change fraud email** before the ~$355k Atlas payment (the corrected April invoice).
4. **Qty mismatch** — Luis enters 660 propeller sets, packing slip and invoice say 600.
5. **Duplicate invoice** — same supplier, same amount, new invoice number suffix.
6. **Duty overcharge** — broker's system misclassifies Atlas's P14 M3 screws as 7318.15.80 (≥ 6 mm, 8.5%) instead of 7318.15.60 (6.2%) on every entry from June. Each is below materiality; the 3rd occurrence trips "recurring 3+ times" → case covering all entries.
7. **GRNI** — late-March receipt, April invoice.
8. **Defect → return → July credit.**
9. **Mid-contract price change** May 1.
10. **Immaterial $640 variance** → rejected → never re-raised.
14. **History (§7a):** hidden internal rules, decoys, a counterexample, a drifted threshold, the bank-change near-miss; in-sim override and an emergent rule.
11. **Export restriction** on Part P07's material in June → cover calc, switch.
12. **Clean supplier** (Northwind) → zero findings.
13. Edge: unknown supplier invoice; missing certificate of origin → escalate.

**Scorecard (`scripts/score.ts` + UI page):** recall on planted problems, false findings, correct handling, $ identified vs. key, controls violations (must be 0), trial balance balanced each close (must be true). Show in demo and README as **proof it works**. Optional second seeded run to show it isn't overfit.

**Optional benchmark:** if Hyphenate's listed Invoice Sandbox Benchmark fits in ≤2 hours, run `extract_document` against it and report the score in the README.

**Judge-scenario resilience:** upload an invoice (PDF/JSON) for any supplier → extract, match, check compliance, or escalate cleanly. Test before Sunday.

---

## 12. UI

1. **Timeline bar:** sim date, month slider, run controls, period status.
2. **Desk overview:** three seat cards with today's actions; open cases; $ protected; items awaiting approval.
3. **Company Map:** graph of Product/BOM/Part/Supplier/Contract/PO/Receipt/Invoice/Payment/JE; click any node for details; highlight the path behind a selected decision.
4. **Approval queue:** requests with evidence, requester, required approvers, threshold triggered; Approve / Reject (reason) / Ask why; "Dana (simulated)" vs. "Me" toggle.
5. **Case view:** history across months.
6. **Supplier scorecards:** trend by month.
7. **Ledger:** trial balance by period, JEs with source links, Beancount export.
8. **Audit trail:** append-only stream, filters.
9. **Scorecard page.**

Badges: "SIMULATED COMPANY"; reference data shows source + retrieval date; compliance shows "Policy modeled on federal drone component restrictions — verify with counsel."

---

## 13. Build order by priority (commit after each step)

**Tier 1 — core + headline moment**
1. Scaffold Next.js + Tailwind + Vitest; `.env.local`; `.gitignore`.
2. Types + ERP data model (`lib/erp/`), ledger with invariants + tests.
3. Deterministic engines: match, landed cost (with real HTS rates cached), FX, compliance check + tests. **Don't continue until tests pass.**
4. Data generator + `answer_key.json` (problems 1, 2, 4, 5, 6, 12, 13 first).
4a. Rescale to the >$100M company (`data/company.json`, `data/controls.json`, opening trial balance, realistic part costs, 300 units/month).
4b. Company history + hidden rules (`data/history/`), rule language/evaluator/miner stats (`lib/rules/`) + tests (§7a).
5. Convex state, audit trail, request/approval queue with segregation-of-duties checks, learned-rule store.
6. AP clerk agent + controls → catches problems 1, 2, 4, 5, 6; clean on 12; escalates 13.
7. Minimal UI: approval queue, case view, invoice-vs-PO-vs-receipt diff, simple audit trail.

**Tier 2 — what wins the track**
8. Sim clock + month-by-month persistence + period close.
9. Dana, Mei, Luis personas with scripted demo decisions; reminders/escalation; "Play the controller" toggle.
10. Remittance fraud hold (3) + previous-clerk handoff.
11. Inventory accountant: GRNI (7), price change (9), defect credit (8), remembered rejection (10).
12. Buyer: scorecards, Raj override, export restriction (11).
13. Scorecard page + `scripts/score.ts` (incl. rule discovery P/R and cold-vs-memory escalations per month).
14. Company Map view with "path behind this decision".

**Tier 3 — polish / extra tracks**
15. EDGAR supplier financials in scorecard.
16. Upload-any-invoice flow (judge scenario) + PDF extraction.
17. Beancount export; optional Increase sandbox payments; optional benchmark.
18. README, deploy (Vercel), record demo video.

**Checkpoints**
- Friday night: Tier 1 steps 1–3 (engines tested with real HTS data).
- Saturday ~2 PM: Tier 1 done; headline moment works end to end.
- Saturday ~9 PM: Tier 2 steps 8–13 done; Devpost draft submitted; video recorded. **Feature freeze.**
- Sunday before 9 AM: Tier 3 only if safe. No risky changes after 7 AM.

---

## 14. Demo (live ~2 min) and video

**Video opens with the moment (first 15 s):** Invoice from Vireo → AP flags: "Substituted flight controller — certificate of origin shows a restricted source. Payment held. ~$3.8M of federal revenue at risk (120 federal-bound units)." Company Map highlights the path; Mei rejects the substitution.

**Live script**
1. (10 s) Seat line.
2. (30 s) Run April. Seats work; audit trail streams. Vireo substitution caught → hold → Dana asks "why?" → AP answers with the certificate, BOM part number, policy rule; Mei rejects.
3. (20 s) Atlas $132 vs. $118 → defended with C-12 §4.2; then the "new bank details" email → held, vendor master untouched.
4. (20 s) Scrub to July: defect credit matched to May case; GRNI reversed; $640 variance Dana rejected in April not re-raised. "Learned rules" panel: rules mined from 2025 history with evidence; escalations per month falling.
5. (15 s) June export restriction: 8 weeks of cover, switch proposed, cost impact booked after approval; Raj override respected elsewhere.
6. (15 s) Scorecard: planted problems caught, zero false findings, zero control violations, books balanced every close.
7. Invite: "Play the controller" or "Hand me any invoice."

**Proof section:** real (HTS duty rates, FX, EDGAR, deterministic math + tests), simulated (company, documents, people), how we know (answer key + scorecard, test suite).

---

## 15. README must include

Seat one-liner first; company, seats, permission table, controls; real vs. simulated + how we know; **where it could go wrong** + mitigations (wrong extraction → flagged fields + human review; compliance policy misapplied → policy as data, engineering + controller approval, "verify with counsel"; false holds delaying suppliers → materiality, evidence, fast escalation; fraud → vendor master as system of record); sponsor tracks; setup; no secrets.

---

## 16. Working style for Claude Code

- Correctness over features. Cut scope, not correctness.
- Work tier by tier; don't start Tier 2 until Tier 1 runs end to end.
- Tests first for every deterministic engine; run tests before every commit.
- Ask before adding dependencies beyond §4.
- Never fabricate duty rates, FX rates, or legal rules. If a value can't be confirmed from a source, stop and ask.
- Deterministic code wherever possible; the LLM only for judgment, extraction, and language.
- Mock the Anthropic client in tests.
- Keep the app runnable at every commit.

---

## Notes for me (not for Claude Code)

- Hyphenate workshop **tonight 7 PM**. Ask: is compliance-aware P2P "new" to them? Which AP/accrual edge cases would they test?
- Verify the drone component restriction details with a mentor or quick research before writing the compliance seed data.
- Find a teammate at the mixer: give them the UI + simulation (Tier 2 steps 9, 14); I own engines + agents.
