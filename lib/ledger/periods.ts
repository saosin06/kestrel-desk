import type { ISODate, PeriodId } from "@/lib/erp/types";
import { LedgerError, type Ledger } from "./state";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function periodOf(date: ISODate): PeriodId {
  return date.slice(0, 7);
}

function assertPeriodId(id: PeriodId): void {
  if (!PERIOD_RE.test(id)) throw new LedgerError("UNKNOWN_PERIOD", `"${id}" is not a YYYY-MM period`);
}

export function openPeriod(ledger: Ledger, id: PeriodId): Ledger {
  assertPeriodId(id);
  const existing = ledger.periods[id];
  if (existing?.status === "locked") throw new LedgerError("PERIOD_LOCKED", `${id} is locked and cannot be reopened`);
  if (existing) return ledger;
  return Object.freeze({
    ...ledger,
    periods: Object.freeze({ ...ledger.periods, [id]: Object.freeze({ id, status: "open" as const }) }),
  });
}

/** Locking is one-way: corrections after close post in a later open period. */
export function lockPeriod(ledger: Ledger, id: PeriodId): Ledger {
  const existing = ledger.periods[id];
  if (!existing) throw new LedgerError("UNKNOWN_PERIOD", `${id} does not exist`);
  if (existing.status === "locked") return ledger;
  return Object.freeze({
    ...ledger,
    periods: Object.freeze({ ...ledger.periods, [id]: Object.freeze({ id, status: "locked" as const }) }),
  });
}

export function assertPostable(ledger: Ledger, period: PeriodId, date: ISODate): void {
  const p = ledger.periods[period];
  if (!p) throw new LedgerError("UNKNOWN_PERIOD", `${period} does not exist`);
  if (p.status === "locked") throw new LedgerError("PERIOD_LOCKED", `${period} is locked`);
  if (periodOf(date) !== period) {
    throw new LedgerError("DATE_OUTSIDE_PERIOD", `date ${date} is not in period ${period}`);
  }
}
