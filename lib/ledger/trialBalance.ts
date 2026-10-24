import type { AccountType, PeriodId } from "@/lib/erp/types";
import type { Ledger } from "./state";

export type TrialBalanceRow = {
  account: string;
  name: string;
  type: AccountType;
  debitCents: number;
  creditCents: number;
  /** debits − credits (positive = debit balance) */
  balanceCents: number;
};

export type TrialBalance = {
  throughPeriod: PeriodId | null;
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
};

/** Cumulative trial balance through a period (inclusive), or over all entries. */
export function trialBalance(ledger: Ledger, throughPeriod?: PeriodId): TrialBalance {
  const totals = new Map<string, { d: number; c: number }>();
  for (const e of ledger.entries) {
    if (throughPeriod && e.period > throughPeriod) continue;
    for (const l of e.lines) {
      const t = totals.get(l.account) ?? { d: 0, c: 0 };
      t.d += l.debitCents;
      t.c += l.creditCents;
      totals.set(l.account, t);
    }
  }
  const rows = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, t]) => {
      const acct = ledger.accounts[code];
      return {
        account: code,
        name: acct.name,
        type: acct.type,
        debitCents: t.d,
        creditCents: t.c,
        balanceCents: t.d - t.c,
      };
    });
  const totalDebitCents = rows.reduce((a, r) => a + r.debitCents, 0);
  const totalCreditCents = rows.reduce((a, r) => a + r.creditCents, 0);
  return {
    throughPeriod: throughPeriod ?? null,
    rows,
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents,
  };
}

/** Debit-positive balance of one account through a period. */
export function accountBalance(ledger: Ledger, account: string, throughPeriod?: PeriodId): number {
  return trialBalance(ledger, throughPeriod).rows.find((r) => r.account === account)?.balanceCents ?? 0;
}
