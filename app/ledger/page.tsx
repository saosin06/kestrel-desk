import { GatewayPostings } from "@/components/postings";
import { PageHeader, Panel } from "@/components/ui";
import { createLedger, loadChartOfAccounts, postOpeningBalances, trialBalance } from "@/lib/ledger";
import { date, usd } from "@/lib/ui/format";
import { desk } from "@/lib/ui/world";

export const metadata = { title: "General ledger" };

export default function Ledger() {
  const tb = trialBalance(postOpeningBalances(createLedger(loadChartOfAccounts())), "2026-02");
  const { world } = desk();
  const sales = world.sales;
  const hw = sales.reduce((a, s) => a + s.hardwareRevenueCents, 0);
  const sv = sales.reduce((a, s) => a + s.servicesRevenueCents, 0);
  return (
    <>
      <PageHeader title="General ledger" subtitle="USD functional currency. Double-entry with locked periods; corrections post as reversals, never edits." />
      <GatewayPostings />
      <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
        <Panel title={`Trial balance · opening, ${date("2026-02-28")}`} flush note={tb.balanced ? "Balanced: debits equal credits." : "OUT OF BALANCE"}>
          <table className="tbl">
            <thead><tr><th>Account</th><th>Name</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>{tb.rows.map((r) => <tr key={r.account}><td className="id">{r.account}</td><td>{r.name}</td><td className="num">{r.balanceCents > 0 ? usd(r.balanceCents) : ""}</td><td className="num">{r.balanceCents < 0 ? usd(-r.balanceCents) : ""}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="num">{usd(tb.totalDebitCents)}</td><td className="num">{usd(tb.totalCreditCents)}</td></tr></tfoot>
          </table>
        </Panel>
        <Panel title="Revenue, March–September 2026" flush note="From monthly sales summaries (K2 units × ASP by customer mix, plus software and services). Posted at close.">
          <table className="tbl">
            <thead><tr><th>Month</th><th className="num">K2 units</th><th className="num">Hardware</th><th className="num">Services</th><th className="num">Federal share</th></tr></thead>
            <tbody>{sales.map((s) => <tr key={s.period}><td>{date(s.period)}</td><td className="num">{s.units}</td><td className="num">{usd(s.hardwareRevenueCents)}</td><td className="num">{usd(s.servicesRevenueCents)}</td><td className="num">{usd(s.byCustomerType.federal)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{sales.reduce((a, s) => a + s.units, 0).toLocaleString("en-US")}</td><td className="num">{usd(hw)}</td><td className="num">{usd(sv)}</td><td className="num">{usd(sales.reduce((a, s) => a + s.byCustomerType.federal, 0))}</td></tr></tfoot>
          </table>
        </Panel>
      </div>
    </>
  );
}
