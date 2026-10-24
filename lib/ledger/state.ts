import type { JournalEntry, LedgerAccount, Period, PeriodId } from "@/lib/erp/types";

export type LedgerErrorCode =
  | "UNBALANCED"
  | "TOO_FEW_LINES"
  | "BAD_LINE"
  | "UNKNOWN_ACCOUNT"
  | "UNKNOWN_PERIOD"
  | "PERIOD_LOCKED"
  | "DATE_OUTSIDE_PERIOD"
  | "NOT_AUTHORIZED"
  | "DUPLICATE_ID"
  | "UNKNOWN_ENTRY"
  | "ALREADY_REVERSED"
  | "CANNOT_REVERSE_REVERSAL";

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "LedgerError";
  }
}

/** Immutable ledger state. Every operation returns a new Ledger. */
export type Ledger = {
  readonly accounts: Readonly<Record<string, LedgerAccount>>;
  readonly periods: Readonly<Record<PeriodId, Period>>;
  readonly entries: readonly JournalEntry[];
  /** original entry id → id of the entry that reversed it */
  readonly reversedBy: Readonly<Record<string, string>>;
};

export function createLedger(accounts: readonly LedgerAccount[], periods: readonly Period[] = []): Ledger {
  const byCode: Record<string, LedgerAccount> = {};
  for (const a of accounts) {
    if (byCode[a.code]) throw new LedgerError("DUPLICATE_ID", `account ${a.code} defined twice`);
    byCode[a.code] = Object.freeze({ ...a });
  }
  const byId: Record<PeriodId, Period> = {};
  for (const p of periods) byId[p.id] = Object.freeze({ ...p });
  return Object.freeze({
    accounts: Object.freeze(byCode),
    periods: Object.freeze(byId),
    entries: Object.freeze([]),
    reversedBy: Object.freeze({}),
  });
}

export function findEntry(ledger: Ledger, id: string): JournalEntry | undefined {
  return ledger.entries.find((e) => e.id === id);
}
