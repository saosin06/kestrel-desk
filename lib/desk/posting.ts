// What the gateway writes to the systems of record once a request is fully approved.
// Pure, no path aliases: imported by the Convex `decide` mutation and by tests.
// The desk never writes a record any other way: agents request, people approve, this posts.

export type PostingLine = { account: string; name: string; debitCents: number; creditCents: number };
export type Posting = {
  /** The system of record written to. */
  system: "General ledger" | "Bank" | "AP subledger" | "Payroll provider" | "ERP — engineering change" | "HRIS";
  /** Ref prefix; the gateway numbers it (JE-000001, ACH-000001, …). */
  prefix: "JE" | "ACH" | "HOLD" | "PAY" | "ECR" | "HR";
  memo: string;
  /** Journal lines, for General ledger postings only. Always balanced. */
  lines?: PostingLine[];
};

type Approved = { reqId: string; kind: string; amountUSDCents?: number; payload: unknown };

const ACCOUNTS: Record<string, string> = {
  "1000": "Cash — operating",
  "2000": "Accounts payable — trade",
  "2200": "Accrued liabilities",
  "5100": "Purchase price variance",
};

function je(memo: string, debit: string, credit: string, cents: number): Posting {
  const lines = [
    { account: debit, name: ACCOUNTS[debit], debitCents: cents, creditCents: 0 },
    { account: credit, name: ACCOUNTS[credit], debitCents: 0, creditCents: cents },
  ];
  assertBalanced(lines);
  return { system: "General ledger", prefix: "JE", memo, lines };
}

export function assertBalanced(lines: PostingLine[]): void {
  const d = lines.reduce((a, l) => a + l.debitCents, 0);
  const c = lines.reduce((a, l) => a + l.creditCents, 0);
  if (lines.length < 2 || d !== c || d <= 0 || lines.some((l) => !Number.isInteger(l.debitCents) || !Number.isInteger(l.creditCents))) {
    throw new Error(`unbalanced journal entry: debits ${d}, credits ${c}`);
  }
}

/** The postings for a request that just became approved. Rejected requests post nothing. */
export function postingsFor(r: Approved): Posting[] {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const subject = String(p.invoiceId ?? p.runId ?? (Array.isArray(p.objectIds) ? p.objectIds[0] : "") ?? "");
  const amount = r.amountUSDCents ?? 0;
  switch (r.kind) {
    case "payment":
      if (amount <= 0) return [];
      return [
        { system: "Bank", prefix: "ACH", memo: `ACH to remit-to ${String(p.remitTo ?? "on file")} (vendor master) for ${subject}` },
        je(`Pay ${subject} (${r.reqId})`, "2000", "1000", amount),
      ];
    case "debit_memo":
      if (amount <= 0) return [];
      return [je(`Debit memo to supplier on ${subject}: overcharge recovered (${r.reqId})`, "2000", "5100", amount)];
    case "payment_hold":
      return [{ system: "AP subledger", prefix: "HOLD", memo: `Payment block on ${subject}; no payment can be scheduled until released (${r.reqId})` }];
    case "payroll_run_approval": {
      const excluded = Array.isArray(p.excluded) ? p.excluded.length : 0;
      const out: Posting[] = [{ system: "Payroll provider", prefix: "PAY", memo: `${subject} released to the provider${excluded ? `, ${excluded} line(s) held back` : ""} (${r.reqId})` }];
      if (amount > 0) out.push(je(`Net pay, ${subject}; gross, taxes and benefits post from the provider register at close (${r.reqId})`, "2200", "1000", amount));
      return out;
    }
    case "payroll_line_hold":
      return [{ system: "Payroll provider", prefix: "PAY", memo: `${String(p.employeeId ?? "line")} removed from ${subject} before release (${r.reqId})` }];
    case "substitution_approval":
      return [{ system: "ERP — engineering change", prefix: "ECR", memo: `Substitution on ${subject} accepted by engineering and the controller (${r.reqId})` }];
    case "hris_change":
      return [{ system: "HRIS", prefix: "HR", memo: `Change ticket for ${String(p.employeeId ?? "employee")} opened with HR (${r.reqId})` }];
    default:
      return [];
  }
}

export type DiffLine = { field: string; before: string; after: string };

/** Field-level diff for the audit trail. */
export function diff(before: Record<string, string>, after: Record<string, string>): DiffLine[] {
  return Object.keys({ ...before, ...after })
    .filter((k) => before[k] !== after[k])
    .map((k) => ({ field: k, before: before[k] ?? "∅", after: after[k] ?? "∅" }));
}
