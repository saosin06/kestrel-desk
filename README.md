# Kestrel Desk

**It fills two seats on Kestrel's disbursements desk — AP clerk and payroll specialist — on top of a staff accountant's ledger that only posts approved entries. It has read-only access to the books, no approval rights, an append-only audit trail, and it escalates to the controller anything material, non-compliant, or uncertain.**

Built at Cal Hacks 13.0 for the **Hyphenate** track: *Autonomous Systems for Finance.*

---

## The company

**Kestrel Aerial** (fictional) makes mapping and firefighting drones: **$137M revenue**, about 420 employees, and 300 K2 drones a month built from 15 parts bought from 6 suppliers. About 40% of sales go to federal agencies, so a part's country of origin decides whether Kestrel can sell the drone at all.

The desk handles **everything that leaves Kestrel's bank account**: supplier invoices and biweekly payroll. Both share one bank, one approval queue and one fraud pattern, which is an email asking to "update my bank details".

## Proof it works

The simulated company has problems planted in it, and a hidden answer key the agents never see. Here's one full agent run over March–September 2026, scored against that key (`npm run score`, or the **Scorecard** page, which grades it row by row):

| | |
|---|---|
| Planted problems that should reach the controller | **20 / 20** caught |
| Immaterial or rule-covered items that should stay quiet | **13 / 13** stayed quiet |
| False findings | **0** |
| Dollars identified | **$2,794,779.53 of $2,794,779.53** |
| Payments requested on a problem invoice | **0** |
| Control violations | **0** |
| Escalations to the controller, Apr–Sep | **29 → 17 (41% fewer)** after learning, with the same catch rate |

Plus **187 tests**. The deterministic checks must find exactly the answer key's problems, no more and no fewer, on two different seeds.

## Learn → run → escalate → improve

- **Learn.** The desk mines 14 months of Kestrel's history (past exceptions, Dana the controller's decisions and reasons, policy memos) for unwritten rules. One example: "Cascade's receipt counts are often off by a few; recount before raising it." Each rule shows its support, counterexamples and confidence. The history also contains decoys, a threshold that drifted, and a near-miss trap, and the miner has to get past all of them.
- **Run.** Claude agents work the AP clerk and payroll specialist seats. Each seat can only use its own tools. The agents never do the math: matching, duty, FX, withholding and FICA are all computed in TypeScript.
- **Escalate.** Anything material, non-compliant or uncertain goes to Dana with evidence. The agents can only *request*. Segregation of duties is enforced in code at one gateway, so no agent can approve, pay, post, or edit bank details, and a refused attempt is written to the audit trail like everything else.
- **Improve.** Every correction becomes precedent. When Dana decides a hold, her decision is recorded like a past exception and the rules are re-mined with the same thresholds: a matching rule gains support, a rule she overrules goes back to her for review, and a pattern that reaches 5 cases becomes a proposed rule. A rule only takes effect once Dana approves it. Rules can make an item routine; they never hide it. A suppressed finding is still logged with the rule that suppressed it. Compliance, bank changes and duplicate payments can never be learned away.

## Hyphenate's four questions

| | Kestrel Desk |
|---|---|
| **World:** where does it act? | One company graph: invoice → line → part → contract → PO → receipt → certificate of origin → policy, plus HRIS → timesheet → payroll register. Every case page draws the path it used. |
| **Time:** what does it remember next quarter? | Seven simulated months with persistent cases, approvals and learned rules. Rules mined from 14 months of history, and an issue already open is never raised twice. |
| **Team:** who does it work with? | Dana (controller) approves, Mei (engineering) signs off substitutions, Luis (receiving) recounts, Priya (HR) owns the HRIS. The agents ask; the people decide. |
| **Limits:** what may it do, and can it prove why? | Requests only, enforced in code. Once every required approver signs, the gateway (and nothing else) writes to the system of record: a balanced journal entry, a bank ACH, a payment block, a payroll release. Every tool call, request, decision, posting and refusal is in the append-only audit trail with a before/after diff, written in the same transaction as the change. |

Convex is the **system of work**: cases, requests, approvals, learned rules and the log. The ERP-style records, HRIS and bank are the **systems of record**, and the agents only read them.

## What it catches

- **Restricted-origin substitute.** Vireo quietly ships a cheaper flight controller, and its certificate of origin shows a restricted country. The payment is held. Engineering and the controller have to sign off. Federal revenue at risk is flagged.
- **Contract price.** Atlas invoices $132/motor against a $118 contract (C-12 §4.2). The desk holds $42,000 and cites the clause.
- **Bank-change fraud.** The day before payday, an email asks to change an employee's direct deposit; the payroll specialist holds it. In **Try it live**, a fake "Atlas Motors" email asks to redirect a supplier payment; the AP clerk holds that too. The HRIS and the vendor master are the systems of record, so neither is ever edited from an email.
- **Payroll.**
  - a ghost employee who shares a real employee's bank account
  - a terminated employee who is still being paid
  - a missed raise
  - overtime paid at straight time
  - Social Security withheld past the $184,500 wage base
  - 401(k) contributions past the $24,500 limit
  - an employee moved to a state where Kestrel isn't registered
  - a duplicated off-cycle check
- **Customs.** The broker misclassifies M3 screws at 8.5% instead of 6.2%. Each entry is small; the third one makes it a recurring problem.
- **Also caught:** a receipt quantity that disagrees with the packing slip, a duplicate invoice, an unknown supplier, and a missing certificate of origin.

## Real vs. simulated

| Real (cited and cached in `data/cache/`) | Simulated |
|---|---|
| USITC Harmonized Tariff Schedule duty rates | The company, its suppliers and its people |
| ECB reference FX rates | Invoices, receipts, emails, payroll registers |
| IRS 2026 Pub 15-T withholding, Pub 15 FICA, the 401(k) limit, FLSA overtime | 14 months of history, plus the answer key |

The compliance policy is data, labeled *"modeled on federal drone component restrictions — verify with counsel."* Money is stored as integer cents and rounded half-up. The demo runs offline from the cache.

## Tracks

- **Hyphenate.** It works the way a finance team actually works:
  - named seats and a permission table
  - three-way match, materiality, segregation of duties and an append-only audit trail
  - systems of record named whenever sources disagree
  - month-by-month time
  - learning from the company's own history

  The scorecard shows the claims hold up.
- **Anthropic.** Claude (`claude-sonnet-5-5`) runs each seat in a tool-use loop with seat-scoped tools, a turn budget and a cached system prompt. Claude also powers the live document extraction and the **Ask why** answers. It handles judgment and language. It never does arithmetic, and it never sees the answer key.
- **Convex.** The system of work: cases, requests, approvals, postings, the audit trail and the learned rules, all updating live. Every approval goes through one gateway (`convex/decisions.ts`): segregation of duties from `lib/desk/sod.ts`, then the postings from `lib/desk/posting.ts` (balanced or refused), in one transaction with the audit entry and its diff. Refusals are logged too.

## Try it live

- **Acting as → Controller** lets you make Dana's decisions yourself: approve, reject, or ask why. Switch to someone who isn't an approver and try anyway: the gateway refuses and logs it.
- **Try it live** lets you hand the desk any invoice or a suspicious email and watch it match, check, hold or escalate.
- **Reset demo** puts everything back to the start.

## Where it could go wrong

| Risk | Mitigation |
|---|---|
| Wrong extraction | Claude flags fields it is unsure of for human review, and the deterministic checks still run on the result |
| Compliance policy applied wrongly | The policy is data; engineering and the controller both approve; "verify with counsel" |
| False holds that delay suppliers | Materiality thresholds, evidence on every case, fast escalation |
| A learned rule hides a real problem | Dana approves every rule, suppressed findings stay logged, and some kinds are never learnable |
| Fraud | Bank details come only from the vendor master or the HRIS, never from email |

## Status

- The **AP clerk** and **payroll specialist** seats run as Claude agents.
- The **staff accountant** seat is a ledger that only posts approved journal entries, with balanced entries, locked periods and reversals. It's tested but not yet agent-driven.
- The **buyer** seat (scorecards, export restriction, switching suppliers) is next.

## Run it

```bash
npm install
cp .env.example .env.local          # add ANTHROPIC_API_KEY here, never in a tracked file
npx convex dev                      # separate terminal; local deployment, no account
npm run seed -- --snapshot data/desk/agents-seed42.json   # load the saved agent run
npm run dev                         # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | 187 tests |
| `npm run score` | scores a desk run against the answer key |
| `npm run sim` | re-runs every seat across Mar–Sep with Claude (needs the API key) |
| `npm run generate` | rebuilds the simulated world from a seed |

Next.js 16 · React 19 · Tailwind 4 · Convex · Anthropic SDK · Vitest
