import type { JournalEntry, Request } from "@/lib/erp/types";
import { assertPostable } from "./periods";
import { LedgerError, type Ledger } from "./state";

/**
 * Checks that an approved journal_entry request backs this entry. Full
 * segregation-of-duties checks (approver ≠ requester, approver in
 * requiredApprovers) live in lib/controls.ts.
 */
export function assertAuthorized(je: Pick<JournalEntry, "id" | "requestId">, auth: Request): void {
  if (auth.kind !== "journal_entry") {
    throw new LedgerError("NOT_AUTHORIZED", `request ${auth.id} is a ${auth.kind} request, not journal_entry`);
  }
  if (auth.status !== "approved") {
    throw new LedgerError("NOT_AUTHORIZED", `request ${auth.id} is ${auth.status}, not approved`);
  }
  if (auth.id !== je.requestId) {
    throw new LedgerError("NOT_AUTHORIZED", `entry ${je.id} cites request ${je.requestId}, got ${auth.id}`);
  }
}

export function validateEntry(ledger: Ledger, je: JournalEntry): void {
  if (ledger.entries.some((e) => e.id === je.id)) {
    throw new LedgerError("DUPLICATE_ID", `entry ${je.id} already posted`);
  }
  assertPostable(ledger, je.period, je.date);
  if (je.lines.length < 2) throw new LedgerError("TOO_FEW_LINES", `entry ${je.id} has ${je.lines.length} line(s)`);

  let debits = 0;
  let credits = 0;
  je.lines.forEach((line, i) => {
    const where = `entry ${je.id} line ${i + 1}`;
    if (!ledger.accounts[line.account]) throw new LedgerError("UNKNOWN_ACCOUNT", `${where}: account ${line.account}`);
    const { debitCents: d, creditCents: c } = line;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0) {
      throw new LedgerError("BAD_LINE", `${where}: amounts must be non-negative integer cents`);
    }
    if ((d > 0) === (c > 0)) {
      throw new LedgerError("BAD_LINE", `${where}: exactly one of debit or credit must be positive`);
    }
    debits += d;
    credits += c;
  });
  if (debits !== credits) {
    throw new LedgerError("UNBALANCED", `entry ${je.id}: debits ${debits} ≠ credits ${credits}`);
  }
}

function freezeEntry(je: JournalEntry): JournalEntry {
  return Object.freeze({
    ...je,
    lines: Object.freeze(je.lines.map((l) => Object.freeze({ ...l }))) as JournalEntry["lines"],
    sourceRefs: Object.freeze([...je.sourceRefs]) as string[],
  });
}

/** Posts an approved entry. Entries are never edited afterwards, only reversed. */
export function post(ledger: Ledger, je: JournalEntry, auth: Request): Ledger {
  assertAuthorized(je, auth);
  validateEntry(ledger, je);
  return appendEntry(ledger, je);
}

export function appendEntry(ledger: Ledger, je: JournalEntry): Ledger {
  const reversedBy = je.reversesId
    ? Object.freeze({ ...ledger.reversedBy, [je.reversesId]: je.id })
    : ledger.reversedBy;
  return Object.freeze({
    ...ledger,
    entries: Object.freeze([...ledger.entries, freezeEntry(je)]),
    reversedBy,
  });
}
