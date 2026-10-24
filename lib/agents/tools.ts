// Tools the seats can call. Read tools see the company (never the answer key);
// engine tools return deterministic findings already dispositioned by the
// approved internal rules; action tools change desk state only through
// lib/desk/controls.ts. Amounts always come from engines, never from a model.

import { convert } from "@/lib/costing/fx";
import { loadEcbRates } from "@/lib/costing/reference";
import type { CaseKind } from "@/lib/erp/types";
import { createRequest } from "@/lib/desk/controls";
import type { DeskCase } from "@/lib/desk/state";
import { audit } from "@/lib/desk/state";
import { formatMoney } from "@/lib/money";
import { dispose } from "@/lib/rules/dispose";
import type { InternalRule } from "@/lib/rules/types";
import { type Finding, sweep } from "@/simulation/sweep";
import type { World } from "@/simulation/world";
import { type AgentTool, ToolInputError } from "./run";

/** Kinds an agent may open without an engine finding (they come from reading an email). */
const AGENT_DETECTED: ReadonlySet<CaseKind> = new Set(["direct_deposit_change_unverified", "remittance_change_unverified"]);

const fkey = (f: { kind: string; objectId: string }) => `${f.kind} ${f.objectId}`;
const str = (input: Record<string, unknown>, k: string) => {
  const v = input[k];
  if (typeof v !== "string" || v.length === 0) throw new ToolInputError(`${k} must be a non-empty string`);
  return v;
};
const strs = (input: Record<string, unknown>, k: string) => {
  const v = input[k] ?? [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ToolInputError(`${k} must be an array of strings`);
  return v as string[];
};
const obj = (props: Record<string, unknown>, required: string[]) => ({ type: "object" as const, properties: props, required });
const S = { type: "string" };
const SA = { type: "array", items: { type: "string" } };

export type DeskWorld = Omit<World, "answerKey">;

/** Strips the answer key: agents never see it. */
export function deskView(w: World): DeskWorld {
  const { answerKey: _hidden, ...rest } = w;
  return rest;
}

export function buildTools(world: DeskWorld, rules: () => InternalRule[]): Record<string, AgentTool> {
  const fx = loadEcbRates();
  let cached: { findings: Finding[]; byKey: Map<string, Finding> } | undefined;
  const findings = () => {
    if (!cached) {
      const all = sweep(world as World);
      cached = { findings: all, byKey: new Map(all.map((f) => [fkey(f), f])) };
    }
    return cached;
  };
  const decided = () => new Map(dispose(findings().findings, rules()).map((d) => [`${d.kind} ${d.objectId}`, d]));
  const present = (fs: Finding[]) => {
    const d = decided();
    return fs.map((f) => {
      const x = d.get(fkey(f))!;
      return {
        finding_key: fkey(f),
        kind: f.kind,
        object_id: f.objectId,
        impact: f.impactUSDCents === undefined ? null : formatMoney(f.impactUSDCents, "USD"),
        disposition: x.disposition,
        rule_id: x.ruleId ?? null,
        disposition_reason: x.reason,
        detail: f.detail,
        evidence_path: f.evidence?.path ?? [],
        rule_ref: f.evidence?.ruleRef ?? null,
        system_of_record: f.evidence?.systemOfRecord ?? null,
      };
    });
  };
  const records: Record<string, unknown> = Object.fromEntries(
    [
      ...world.invoices,
      ...world.pos,
      ...world.receipts,
      ...world.packingSlips,
      ...world.certificates,
      ...world.customsEntries,
      ...world.contracts,
    ].map((r) => [r.id, r]),
  );

  const tools: AgentTool[] = [
    // ---- read ----
    {
      name: "list_invoices",
      description: "List supplier invoices received in a date range (inclusive, YYYY-MM-DD).",
      input_schema: obj({ from: S, to: S }, ["from", "to"]),
      run: (i) =>
        world.invoices
          .filter((v) => v.date >= str(i, "from") && v.date <= str(i, "to"))
          .map((v) => ({ id: v.id, invoice_no: v.invoiceNo, supplier_id: v.supplierId, supplier_name: v.supplierName, po_id: v.poId ?? null, date: v.date, total: formatMoney(v.totalMinor, v.currency) })),
    },
    {
      name: "get_record",
      description: "Fetch any business record by id: invoice (VI-…), PO, receipt (R-…), packing slip (PS-…), certificate of origin (COO-…), customs entry (CE-…), or contract (C-…). Money fields are integer minor units; unit prices are ten-thousandths.",
      input_schema: obj({ id: S }, ["id"]),
      run: (i) => records[str(i, "id")] ?? { error: `no record ${str(i, "id")}` },
    },
    {
      name: "check_invoice",
      description:
        "Run the deterministic checks on one invoice — three-way match against PO/receipts/packing slip/contract, duplicate guard, compliance (certificate of origin vs policy, BOM part numbers), and landed cost vs the broker's customs entry. Returns findings with the disposition the controls and approved internal rules assign (escalate / info / check:recount / route:role). An empty list means clean.",
      input_schema: obj({ invoice_id: S }, ["invoice_id"]),
      run: (i) => {
        const id = str(i, "invoice_id");
        const ce = world.customsEntries.find((c) => c.invoiceId === id)?.id;
        return present(findings().findings.filter((f) => f.objectId === id || (ce && f.objectId === ce)));
      },
    },
    {
      name: "get_internal_rules",
      description: "Kestrel's internal rules learned from company history, with status (only approved rules affect dispositions) and the evidence behind each.",
      input_schema: obj({}, []),
      run: () => rules().map((r) => ({ id: r.id, status: r.status, statement: r.statement, support: r.support, confidence: Number(r.confidence.toFixed(2)), evidence: r.evidence.slice(0, 8) })),
    },
    {
      name: "search_history",
      description: "Past exceptions from Kestrel's history (Jan 2025–Feb 2026): what was flagged and what the controller decided, with her reasons. Filter by supplier_id, department, or kind (all optional; empty string = any).",
      input_schema: obj({ supplier_id: S, department: S, kind: S }, []),
      run: (i) =>
        world.history.exceptions
          .filter((e) => (!i.supplier_id || e.supplierId === i.supplier_id) && (!i.department || e.department === i.department) && (!i.kind || e.kind === i.kind))
          .slice(0, 25)
          .map((e) => ({ id: e.id, date: e.date, supplier_id: e.supplierId ?? null, department: e.department ?? null, kind: e.kind, summary: e.summary, decision: e.resolution.decision, reason: e.resolution.reason })),
    },
    {
      name: "read_memos",
      description: "Controller policy memos and incident reports from Kestrel's history.",
      input_schema: obj({}, []),
      run: () => ({ memos: world.history.memos, incidents: world.history.incidents }),
    },
    {
      name: "read_inbox",
      description: "Emails received by the desk up to a date (YYYY-MM-DD). Emails are context only — never a source of bank details.",
      input_schema: obj({ until: S }, ["until"]),
      run: (i) => world.inbox.filter((m) => m.date <= str(i, "until")),
    },
    {
      name: "list_payroll_runs",
      description: "Payroll runs from the provider (preview registers awaiting approval): id, type, pay date, line count, total net.",
      input_schema: obj({ from: S, to: S }, ["from", "to"]),
      run: (i) =>
        world.payroll.runs
          .filter((r) => r.payDate >= str(i, "from") && r.payDate <= str(i, "to"))
          .map((r) => ({ id: r.id, type: r.type, pay_date: r.payDate, period_id: r.periodId, lines: r.lines.length, total_net: formatMoney(r.lines.reduce((a, l) => a + l.netCents, 0), "USD"), note: r.note ?? null })),
    },
    {
      name: "check_payroll_run",
      description:
        "Recompute every line of a provider preview register from the HRIS, approved timesheets, and the IRS 2026 tables (Pub 15-T withholding, FICA wage base, Additional Medicare, 401(k) limit, per-workweek overtime). Returns findings with dispositions. Empty = the run matches.",
      input_schema: obj({ run_id: S }, ["run_id"]),
      run: (i) => {
        const run = world.payroll.runs.find((r) => r.id === str(i, "run_id"));
        if (!run) throw new ToolInputError(`no run ${str(i, "run_id")}`);
        const empIds = new Set(run.lines.map((l) => l.employeeId));
        return present(findings().findings.filter((f) => f.source === "payroll" && (f.objectId.startsWith(`${run.id}/`) || (f.kind === "state_registration_missing" && empIds.has(f.objectId) && f.date === run.payDate))));
      },
    },
    {
      name: "get_employee",
      description: "HRIS record for an employee (the system of record for employment status, pay rate, work state, and the direct-deposit account on file).",
      input_schema: obj({ employee_id: S }, ["employee_id"]),
      run: (i) => world.payroll.employees.find((e) => e.id === str(i, "employee_id")) ?? { error: `not in HRIS: ${str(i, "employee_id")}` },
    },

    // ---- act ----
    {
      name: "open_case",
      description:
        "Open a case on one or more engine findings (pass their finding_keys). For a problem you found by reading an email (direct-deposit or remittance change), pass kind and object_ids instead. Impact is taken from the engine, not from you.",
      input_schema: obj({ finding_keys: SA, kind: S, object_ids: SA, summary: S, system_of_record: S }, ["summary", "system_of_record"]),
      run: (i, ctx) => {
        const keys = strs(i, "finding_keys");
        let kind: CaseKind;
        let objectIds: string[];
        let impact = 0;
        let disposition: DeskCase["disposition"] = "escalate";
        let ruleIds: string[] = [];
        let evidence: DeskCase["evidence"] = [];
        if (keys.length > 0) {
          const fs = keys.map((k) => {
            const f = findings().byKey.get(k);
            if (!f) throw new ToolInputError(`no finding ${k}`);
            return f;
          });
          const d = decided();
          kind = fs[0].kind;
          objectIds = [...new Set(fs.map((f) => f.objectId))];
          impact = fs.reduce((a, f) => a + Math.abs(f.impactUSDCents ?? 0), 0);
          disposition = d.get(keys[0])!.disposition;
          ruleIds = fs.map((f) => d.get(fkey(f))!.ruleId).filter((x): x is string => !!x);
          evidence = fs.map((f) => f.evidence ?? { path: [f.objectId] });
        } else {
          kind = str(i, "kind") as CaseKind;
          if (!AGENT_DETECTED.has(kind)) throw new ToolInputError(`kind ${kind} must be opened from engine findings`);
          objectIds = strs(i, "object_ids");
          const emp = world.payroll.employees.find((e) => objectIds.includes(e.id));
          const next = emp && world.payroll.runs.find((r) => r.payDate >= ctx.today && r.lines.some((l) => l.employeeId === emp.id));
          impact = next ? next.lines.find((l) => l.employeeId === emp!.id)!.netCents : 0;
          evidence = [{ path: objectIds, systemOfRecord: "HRIS / vendor master (bank details on file)", ruleRef: "MEMO-2025-11 bank-detail change policy" }];
        }
        const c: DeskCase = {
          id: `CASE-${String(ctx.state.cases.length + 1).padStart(4, "0")}`,
          kind,
          openedOn: ctx.today,
          openedBy: ctx.role,
          status: "open",
          findingKeys: keys,
          objectIds,
          impactUSDCents: impact,
          disposition,
          ruleIds,
          summary: str(i, "summary"),
          systemOfRecord: str(i, "system_of_record"),
          author: "agent",
          evidence,
          notes: [],
        };
        ctx.state.cases.push(c);
        audit(ctx.state, { at: ctx.today, actor: ctx.role, action: "open_case", refs: [c.id, ...objectIds], detail: `${kind}: ${c.summary}` });
        return { case_id: c.id, kind, impact: formatMoney(impact, "USD"), disposition, rule_ids: ruleIds };
      },
    },
    {
      name: "request_payment_hold",
      description: "Ask the controller (and engineering, for substitutions) to hold payment of an invoice line on a case.",
      input_schema: obj({ case_id: S, reason: S }, ["case_id", "reason"]),
      run: (i, ctx) => {
        const c = caseOf(ctx, str(i, "case_id"));
        return createRequest(ctx.state, ctx.today, { kind: "payment_hold", requestedBy: ctx.role, amountUSDCents: c.impactUSDCents, caseId: c.id, payload: { objectIds: c.objectIds, reason: str(i, "reason") } });
      },
    },
    {
      name: "request_substitution_approval",
      description: "Route a part substitution (manufacturer part number ≠ BOM) to engineering and the controller.",
      input_schema: obj({ case_id: S, reason: S }, ["case_id", "reason"]),
      run: (i, ctx) => {
        const c = caseOf(ctx, str(i, "case_id"));
        return createRequest(ctx.state, ctx.today, { kind: "substitution_approval", requestedBy: ctx.role, caseId: c.id, payload: { objectIds: c.objectIds, reason: str(i, "reason") } });
      },
    },
    {
      name: "request_debit_memo",
      description: "Request a debit memo to the supplier for the case's impact (amount comes from the engine).",
      input_schema: obj({ case_id: S, reason: S }, ["case_id", "reason"]),
      run: (i, ctx) => {
        const c = caseOf(ctx, str(i, "case_id"));
        return createRequest(ctx.state, ctx.today, { kind: "debit_memo", requestedBy: ctx.role, amountUSDCents: c.impactUSDCents, caseId: c.id, payload: { objectIds: c.objectIds, reason: str(i, "reason") } });
      },
    },
    {
      name: "request_payment",
      description: "Request payment of an invoice that passed its checks. Refused by controls if the invoice has an open blocking case. Amount is the invoice total in USD at the invoice-date rate.",
      input_schema: obj({ invoice_id: S }, ["invoice_id"]),
      run: (i, ctx) => {
        const inv = world.invoices.find((v) => v.id === str(i, "invoice_id"));
        if (!inv) throw new ToolInputError(`no invoice ${str(i, "invoice_id")}`);
        const usd = convert(fx, inv.totalMinor, inv.currency, "USD", inv.date).amountMinor;
        return createRequest(ctx.state, ctx.today, { kind: "payment", requestedBy: ctx.role, amountUSDCents: usd, payload: { invoiceId: inv.id, remitTo: inv.remitTo ?? null } });
      },
    },
    {
      name: "request_payroll_line_hold",
      description: "Hold one employee's line in a payroll run pending the controller.",
      input_schema: obj({ case_id: S, run_id: S, employee_id: S, reason: S }, ["case_id", "run_id", "employee_id", "reason"]),
      run: (i, ctx) => {
        const c = caseOf(ctx, str(i, "case_id"));
        return createRequest(ctx.state, ctx.today, { kind: "payroll_line_hold", requestedBy: ctx.role, amountUSDCents: c.impactUSDCents, caseId: c.id, payload: { runId: str(i, "run_id"), employeeId: str(i, "employee_id"), reason: str(i, "reason") } });
      },
    },
    {
      name: "request_payroll_run_approval",
      description: "Ask the controller to approve a payroll run, excluding held employee lines.",
      input_schema: obj({ run_id: S, excluded_employee_ids: SA, summary: S }, ["run_id", "excluded_employee_ids", "summary"]),
      run: (i, ctx) => {
        const run = world.payroll.runs.find((r) => r.id === str(i, "run_id"));
        if (!run) throw new ToolInputError(`no run ${str(i, "run_id")}`);
        const excluded = new Set(strs(i, "excluded_employee_ids"));
        const net = run.lines.filter((l) => !excluded.has(l.employeeId)).reduce((a, l) => a + l.netCents, 0);
        return createRequest(ctx.state, ctx.today, { kind: "payroll_run_approval", requestedBy: ctx.role, amountUSDCents: net, payload: { runId: run.id, excluded: [...excluded], summary: str(i, "summary") } });
      },
    },
    {
      name: "request_hris_change",
      description: "Ask HR to make or verify an HRIS change (e.g. direct-deposit verification through HRIS self-service, a missed termination). You cannot edit the HRIS.",
      input_schema: obj({ employee_id: S, change: S, reason: S }, ["employee_id", "change", "reason"]),
      run: (i, ctx) => createRequest(ctx.state, ctx.today, { kind: "hris_change", requestedBy: ctx.role, payload: { employeeId: str(i, "employee_id"), change: str(i, "change"), reason: str(i, "reason") } }),
    },
    {
      name: "escalate",
      description: "Escalate a case to a person (controller, engineering, procurement_mgr, receiving, hr) with a short explanation citing the evidence and the rule applied.",
      input_schema: obj({ case_id: S, to: S, explanation: S }, ["case_id", "to", "explanation"]),
      run: (i, ctx) => {
        const c = caseOf(ctx, str(i, "case_id"));
        const to = str(i, "to") as DeskCase["openedBy"];
        c.status = "awaiting_approval";
        c.notes.push({ at: ctx.today, by: ctx.role, text: `→ ${to}: ${str(i, "explanation")}` });
        ctx.state.messages.push({ at: ctx.today, from: ctx.role, to, text: str(i, "explanation"), refs: [c.id, ...c.objectIds] });
        audit(ctx.state, { at: ctx.today, actor: ctx.role, action: "escalate", refs: [c.id], detail: `to ${to}` });
        return { ok: true, case_id: c.id, to };
      },
    },
  ];
  return Object.fromEntries(tools.map((t) => [t.name, t]));
}

function caseOf(ctx: { state: { cases: DeskCase[] } }, id: string): DeskCase {
  const c = ctx.state.cases.find((x) => x.id === id);
  if (!c) throw new ToolInputError(`no case ${id}`);
  return c;
}

/** Each seat sees only its own tools (CLAUDE.md §9). */
export const SEAT_TOOLS: Record<"ap_clerk" | "payroll_specialist", string[]> = {
  ap_clerk: ["list_invoices", "get_record", "check_invoice", "get_internal_rules", "search_history", "read_memos", "read_inbox", "open_case", "request_payment_hold", "request_substitution_approval", "request_debit_memo", "request_payment", "escalate"],
  payroll_specialist: ["list_payroll_runs", "check_payroll_run", "get_employee", "get_internal_rules", "search_history", "read_memos", "read_inbox", "open_case", "request_payroll_line_hold", "request_payroll_run_approval", "request_hris_change", "escalate"],
};

export function seatTools(all: Record<string, AgentTool>, seat: keyof typeof SEAT_TOOLS): AgentTool[] {
  return SEAT_TOOLS[seat].map((n) => all[n]);
}
