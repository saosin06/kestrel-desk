import Link from "next/link";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { date, dispositionLabel, dispositionTone, kindLabel, money, usd } from "@/lib/ui/format";
import { desk, findingsFor } from "@/lib/ui/world";

export const metadata = { title: "Payables" };

export default function Payables() {
  const { world, usd: toUsd } = desk();
  const suppliers = Object.fromEntries(world.vendors.map((v) => [v.supplierId, v.legalName]));
  const rows = [...world.invoices].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const total = rows.reduce((a, i) => a + toUsd(i.totalMinor, i.currency, i.date), 0);
  return (
    <>
      <PageHeader title="Payables" subtitle="Supplier invoices received March–September 2026, with the result of three-way match, compliance, duplicate, and customs checks." />
      <Panel flush note={`${rows.length} invoices · USD ${usd(total)} · amounts in invoice currency; USD at the ECB reference rate on the invoice date`}>
        <table className="tbl">
          <thead><tr><th>Invoice</th><th>Supplier no.</th><th>Supplier</th><th>PO</th><th>Date</th><th>Ccy</th><th className="num">Amount</th><th className="num">USD</th><th>Checks</th></tr></thead>
          <tbody>
            {rows.map((inv) => {
              const ce = world.customsEntries.find((c) => c.invoiceId === inv.id);
              const fs = findingsFor([inv.id, ...(ce ? [ce.id] : [])]);
              const worst = fs.find((f) => f.disposition === "escalate") ?? fs.find((f) => f.disposition !== "info") ?? fs[0];
              return (
                <tr key={inv.id}>
                  <td><Link href={`/payables/${inv.id}`} className="id">{inv.id}</Link></td>
                  <td className="id text-ink-2">{inv.invoiceNo}</td>
                  <td>{suppliers[inv.supplierId] ?? <span className="text-[var(--crit)]">{inv.supplierName} (not in vendor master)</span>}</td>
                  <td className="id text-ink-2">{inv.poId ?? "—"}</td>
                  <td className="whitespace-nowrap text-ink-2">{date(inv.date)}</td>
                  <td className="text-ink-2">{inv.currency}</td>
                  <td className="num">{money(inv.totalMinor, inv.currency)}</td>
                  <td className="num">{usd(toUsd(inv.totalMinor, inv.currency, inv.date))}</td>
                  <td className="whitespace-nowrap">
                    {worst ? <Pill tone={dispositionTone(worst.disposition)}>{dispositionLabel(worst.disposition)} · {kindLabel(worst.kind)}</Pill> : <Pill tone="good">Matched</Pill>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
