// Deterministic desk: what the controls and approved internal rules alone
// would do with every finding, day by day. Same shapes the agent seats
// produce (cases, requests, escalations, audit), authored "rules-engine".
// It's the baseline agents are scored against and the offline fallback.

import { convert } from "@/lib/costing/fx";
import { loadEcbRates } from "@/lib/costing/reference";
import type { CaseKind, ISODate, Role } from "@/lib/erp/types";
import { formatMoney } from "@/lib/money";
import { dispose } from "@/lib/rules/dispose";
import type { InternalRule } from "@/lib/rules/types";
import { type Finding, sweep } from "@/simulation/sweep";
import type { World } from "@/simulation/world";
import { BLOCKING_KINDS, createRequest } from "./controls";
import { audit, createDeskState, type DeskCase, type DeskState } from "./state";

const PAYROLL_KINDS: ReadonlySet<CaseKind> = new Set([
  "ghost_employee",
  "terminated_paid",
  "pay_rate_mismatch",
  "overtime_error",
  "payroll_tax_error",
  "deduction_limit",
  "duplicate_payment",
  "hours_mismatch",
  "state_registration_missing",
  "direct_deposit_change_unverified",
]);

/** Who else hears about each kind, beyond the controller. */
const ALSO_NOTIFY: Partial<Record<CaseKind, Role[]>> = {
  noncompliant_substitution: ["engineering"],
  price_variance_vs_contract: ["procurement_mgr"],
  ghost_employee: ["hr"],
  terminated_paid: ["hr"],
  pay_rate_mismatch: ["hr"],
  state_registration_missing: ["hr"],
};

export type DeskRule = InternalRule & { decidedBy?: Role; decidedAt?: ISODate; decisionReason?: string };

export function runDeterministicDesk(world: Omit<World, "answerKey">, rules: DeskRule[]): DeskState & { rules: DeskRule[] } {
  const fx = loadEcbRates();
  const state = createDeskState();
  const findings = sweep(world as World);
  const decisions = new Map(dispose(findings, rules).map((d) => [`${d.kind} ${d.objectId}`, d]));

  // When AP can act on an invoice: once the goods, the invoice, and (for imports) the customs entry are all in.
  const procDate = new Map<string, ISODate>();
  for (const inv of world.invoices) {
    const dates = [inv.date, ...world.receipts.filter((r) => r.poId === inv.poId).map((r) => r.date), ...world.customsEntries.filter((c) => c.invoiceId === inv.id).map((c) => c.date)];
    procDate.set(inv.id, dates.sort().at(-1)!);
  }
  const ceInvoice = new Map(world.customsEntries.map((c) => [c.id, c.invoiceId]));
  const dateOf = (f: Finding): ISODate => {
    if (f.source === "payroll") return addDays(f.date, -1); // reviewed the day before pay date
    const inv = ceInvoice.get(f.objectId) ?? f.objectId;
    return procDate.get(inv) ?? f.date;
  };

  type Event = { date: ISODate; order: number; run: () => void };
  const events: Event[] = [];

  for (const f of findings) {
    const d = decisions.get(`${f.kind} ${f.objectId}`)!;
    const date = dateOf(f);
    const seat: Role = f.source === "payroll" ? "payroll_specialist" : "ap_clerk";
    events.push({
      date,
      order: 0,
      run: () => {
        if (d.disposition === "info") {
          audit(state, { at: date, actor: seat, action: "log:info", refs: [f.objectId, ...(d.ruleId ? [d.ruleId] : [])], detail: `${f.kind}: ${f.detail} — ${d.reason}` });
          return;
        }
        const c: DeskCase = {
          id: `CASE-${String(state.cases.length + 1).padStart(4, "0")}`,
          kind: f.kind,
          openedOn: date,
          openedBy: seat,
          status: "open",
          findingKeys: [`${f.kind} ${f.objectId}`],
          objectIds: [f.objectId, ...(ceInvoice.has(f.objectId) ? [ceInvoice.get(f.objectId)!] : [])],
          impactUSDCents: Math.abs(f.impactUSDCents ?? 0),
          disposition: d.disposition,
          ruleIds: d.ruleId ? [d.ruleId] : [],
          summary: f.detail,
          systemOfRecord: f.evidence?.systemOfRecord ?? "",
          author: "rules-engine",
          evidence: f.evidence ? [f.evidence] : [{ path: [f.objectId] }],
          notes: [],
        };
        state.cases.push(c);
        audit(state, { at: date, actor: seat, action: "open_case", refs: [c.id, ...c.objectIds], detail: `${c.kind}: ${c.summary}` });

        const impact = c.impactUSDCents;
        if (seat === "payroll_specialist") {
          if (f.kind === "state_registration_missing") {
            createRequest(state, date, { kind: "hris_change", requestedBy: seat, caseId: c.id, payload: { employeeId: f.objectId, change: "confirm work state; set up state registration and withholding", reason: f.detail } });
          } else {
            const [runId, employeeId] = f.objectId.split("/");
            createRequest(state, date, { kind: "payroll_line_hold", requestedBy: seat, amountUSDCents: impact, caseId: c.id, payload: { runId, employeeId, reason: f.detail } });
          }
        } else if (f.kind !== "duty_overcharge") {
          createRequest(state, date, { kind: "payment_hold", requestedBy: seat, amountUSDCents: impact, caseId: c.id, payload: { objectIds: c.objectIds, reason: f.detail } });
          if (f.kind === "noncompliant_substitution") createRequest(state, date, { kind: "substitution_approval", requestedBy: seat, caseId: c.id, payload: { objectIds: c.objectIds, reason: f.detail } });
          if (f.kind === "price_variance_vs_contract") createRequest(state, date, { kind: "debit_memo", requestedBy: seat, amountUSDCents: impact, caseId: c.id, payload: { objectIds: c.objectIds, reason: f.detail } });
        }

        const to: Role[] = d.disposition === "check:recount" ? ["receiving"] : d.disposition.startsWith("route:") ? [d.disposition.slice(6) as Role] : ["controller", ...(ALSO_NOTIFY[f.kind] ?? [])];
        c.status = "awaiting_approval";
        for (const role of to) {
          const text = `${c.kind.replaceAll("_", " ")} on ${c.objectIds[0]} (${formatMoney(impact, "USD")}): ${f.detail}.${f.evidence?.ruleRef ? ` Rule: ${f.evidence.ruleRef}.` : ""}${d.ruleId ? ` Internal rule ${d.ruleId}: ${d.reason}.` : ""}${f.evidence?.systemOfRecord ? ` System of record: ${f.evidence.systemOfRecord}.` : ""}`;
          state.messages.push({ at: date, from: seat, to: role, text, refs: [c.id, ...c.objectIds] });
          c.notes.push({ at: date, by: seat, text: `→ ${role}` });
          audit(state, { at: date, actor: seat, action: "escalate", refs: [c.id], detail: `to ${role}` });
        }
      },
    });
  }

  // Payment requests for invoices with no blocking case, after their findings are processed.
  for (const inv of world.invoices) {
    if (!inv.poId) continue;
    const date = procDate.get(inv.id)!;
    events.push({
      date,
      order: 1,
      run: () => {
        const blocked = state.cases.some((c) => c.objectIds.includes(inv.id) && BLOCKING_KINDS.has(c.kind) && c.status !== "resolved");
        if (blocked) return;
        const usd = convert(fx, inv.totalMinor, inv.currency, "USD", inv.date).amountMinor;
        createRequest(state, date, { kind: "payment", requestedBy: "ap_clerk", amountUSDCents: usd, payload: { invoiceId: inv.id, remitTo: inv.remitTo ?? null } });
      },
    });
  }

  // Payroll run approvals the day before each pay date, excluding held lines.
  for (const run of world.payroll.runs) {
    const date = addDays(run.payDate, -1);
    events.push({
      date,
      order: 1,
      run: () => {
        const held = state.cases.filter((c) => PAYROLL_KINDS.has(c.kind) && c.objectIds[0].startsWith(`${run.id}/`)).map((c) => c.objectIds[0].split("/")[1]);
        const net = run.lines.filter((l) => !held.includes(l.employeeId)).reduce((a, l) => a + l.netCents, 0);
        createRequest(state, date, { kind: "payroll_run_approval", requestedBy: "payroll_specialist", amountUSDCents: net, payload: { runId: run.id, excluded: held, summary: `${run.lines.length - held.length} of ${run.lines.length} lines; ${held.length} held` } });
      },
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  for (const e of events) e.run();
  return { ...state, rules };
}

function addDays(date: ISODate, n: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
