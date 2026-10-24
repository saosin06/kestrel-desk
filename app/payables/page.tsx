import Link from "next/link";
import { PageHeader, Panel, Pill, Summary } from "@/components/ui";
import { date, dispositionLabel, dispositionTone, money, usd, usdCompact, WHAT_HAPPENED } from "@/lib/ui/format";
import { desk, findingsFor } from "@/lib/ui/world";

export const metadata = { title: "Payables" };

export default function Payables() {
  const { world, usd: toUsd } = desk();
  const suppliers = Object.fromEntries(world.vendors.map((v) => [v.supplierId, v.legalName]));
  const rows = [...world.invoices]
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .map((inv) => {
      const ce = world.customsEntries.find((c) => c.invoiceId === inv.id);
      const fs = findingsFor([inv.id, ...(ce ? [ce.id] : [])]);
      const worst = fs.find((f) => f.disposition === "escalate") ?? fs.find((f) => f.disposition !== "info") ?? fs[0];
      return { inv, worst, usd: toUsd(inv.totalMinor, inv.currency, inv.date) };
    });
  const flagged = rows.filter((r) => r.worst && r.worst.disposition !== "info");
  const clean = rows.filter((r) => !r.worst || r.worst.disposition === "info");
  const total = rows.reduce((a, r) => a + r.usd, 0);

  const table = (list: typeof rows) => (
    <table className="tbl">
      <thead><tr><th>Invoice</th><th>Date</th><th className="num">Amount</th><th className="num">USD</th><th>Result</th></tr></thead>
      <tbody>
        {list.map(({ inv, worst, usd: u }) => (
          <tr key={inv.id}>
            <td>
              <Link href={`/payables/${inv.id}`} className="text-ink">{suppliers[inv.supplierId] ?? inv.supplierName}</Link>
              <div className="text-[11px] text-muted"><span className="id">{inv.invoiceNo}</span>{inv.poId ? ` · ${inv.poId}` : " · no PO"}</div>
            </td>
            <td className="whitespace-nowrap text-ink-2">{date(inv.date)}</td>
            <td className="num text-ink-2">{inv.currency} {money(inv.totalMinor, inv.currency)}</td>
            <td className="num">{usd(u)}</td>
            <td>
              {!worst ? <Pill tone="good">Matched</Pill> : worst.disposition === "info" ? <Pill tone="neutral">Matched · routine item logged</Pill> : (
                <>
                  <Pill tone={dispositionTone(worst.disposition)}>{dispositionLabel(worst.disposition)}</Pill>
                  <span className="ml-2 text-ink-2">{WHAT_HAPPENED[worst.kind] ?? worst.kind}</span>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <PageHeader title="Payables" />
      <Summary
        text={<>Every supplier invoice is checked before it&apos;s paid: against the purchase order, what the dock received, the contract price, the certificate of origin, and the customs broker&apos;s duty. Only clean invoices go up for payment.</>}
        figures={[
          { label: "invoices, Mar–Sep", value: rows.length },
          { label: "matched", value: clean.length, tone: "good" },
          { label: "flagged", value: flagged.length, tone: "crit" },
          { label: "total value", value: usdCompact(total) },
        ]}
      />
      <Panel title={`Flagged (${flagged.length})`} flush>{table(flagged)}</Panel>
      <details className="mb-4 rounded-[4px] border border-line bg-panel">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">Matched ({clean.length})</summary>
        <div className="border-t border-line">{table(clean)}</div>
      </details>
    </>
  );
}
