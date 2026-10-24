import coaData from "@/data/coa.json";
import type { AccountType, LedgerAccount } from "@/lib/erp/types";

const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

export const ACCOUNTS = {
  cash: "1000",
  accountsReceivable: "1100",
  inventory: "1200",
  debitMemoReceivable: "1300",
  ppe: "1500",
  apTrade: "2000",
  apBroker: "2050",
  grni: "2100",
  accrued: "2200",
  longTermDebt: "2500",
  retainedEarnings: "3000",
  paidInCapital: "3100",
  revenue: "4000",
  servicesRevenue: "4100",
  cogs: "5000",
  ppv: "5100",
  dutyFreightVariance: "5110",
  fxRealized: "5200",
  fxUnrealized: "5210",
} as const;

export function loadChartOfAccounts(): LedgerAccount[] {
  const accounts = coaData.accounts.map((a) => {
    if (!ACCOUNT_TYPES.includes(a.type as AccountType)) {
      throw new Error(`account ${a.code} has unknown type "${a.type}"`);
    }
    return { code: a.code, name: a.name, type: a.type as AccountType };
  });
  const codes = new Set(accounts.map((a) => a.code));
  for (const code of Object.values(ACCOUNTS)) {
    if (!codes.has(code)) throw new Error(`data/coa.json is missing account ${code}`);
  }
  return accounts;
}
