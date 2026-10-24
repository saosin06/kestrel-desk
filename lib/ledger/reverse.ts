import type { ISODate, JournalEntry, PeriodId, Request, Role } from "@/lib/erp/types";
import { appendEntry, assertAuthorized, validateEntry } from "./post";
import { findEntry, LedgerError, type Ledger } from "./state";

export type ReversalSpec = {
  id: string;
  period: PeriodId;
  date: ISODate;
  requestId: string;
  postedBy: Role;
  reason: string;
};

/**
 * Posts the mirror of an entry. If the original's period is locked, the
 * reversal goes in whatever open period the caller names, and the memo cites
 * the original entry and period (CLAUDE.md §7.7).
 */
export function reverse(ledger: Ledger, originalId: string, spec: ReversalSpec, auth: Request): Ledger {
  const original = findEntry(ledger, originalId);
  if (!original) throw new LedgerError("UNKNOWN_ENTRY", `entry ${originalId} not found`);
  if (original.reversesId) {
    throw new LedgerError("CANNOT_REVERSE_REVERSAL", `entry ${originalId} is itself a reversal; post a new entry`);
  }
  if (ledger.reversedBy[originalId]) {
    throw new LedgerError("ALREADY_REVERSED", `entry ${originalId} was reversed by ${ledger.reversedBy[originalId]}`);
  }

  const je: JournalEntry = {
    id: spec.id,
    period: spec.period,
    date: spec.date,
    memo: `Reversal of ${original.id} (period ${original.period}): ${spec.reason}`,
    lines: original.lines.map((l) => ({
      account: l.account,
      debitCents: l.creditCents,
      creditCents: l.debitCents,
      memo: l.memo,
    })),
    sourceRefs: [original.id, ...original.sourceRefs],
    requestId: spec.requestId,
    reversesId: original.id,
    postedBy: spec.postedBy,
  };
  assertAuthorized(je, auth);
  validateEntry(ledger, je);
  return appendEntry(ledger, je);
}
