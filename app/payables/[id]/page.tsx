import { notFound } from "next/navigation";
import { Kv, PageHeader, Panel, Pill } from "@/components/ui";
import { date, dispositionLabel, dispositionTone, kindLabel, money, usd } from "@/lib/ui/format";
import { desk, findingsFor } from "@/lib/ui/world";

export function generateStaticParams() {
  return desk().world.invoices.map((i) => ({ id: i.id }));
}

const price = (e4: number) => (e4 / 10_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default async function InvoicePage({ params }: PageProps<"/payables/[id]">) {
  const { id } = await params;
  const { world, usd: toUsd } = desk();
  const inv = world.invoices.find((i) => i.id === id);
  if (!inv) notFound();
  const vendor = world.vendors.find((v) => v.supplierId === inv.supplierId);
  const po = world.pos.find((p) => p.id === inv.poId);
  const receipts = world.receipts.filter((r) => r.poId === inv.poId);
  const slips = world.packingSlips.filter((s) => s.poId === inv.poId);
  const certs = world.certificates.filter((c) => c.invoiceId === inv.id);
  const ce = world.customsEntries.find((c) => c.invoiceId === inv.id);
  const contracts = world.contracts.filter((c) => c.supplierId === inv.supplierId);
  const findings = findingsFor([inv.id, ...(ce ? [ce.id] : [])]);

  return (
    <>
      <PageHeader crumbs={[{ href: "/payables", label: "Payables" }]} title={<span><span className="id mr-2 text-[15px] text-ink-2">{inv.id}</span>{vendor?.legalName ?? inv.supplierName}</span>} subtitle={`Supplier invoice ${inv.invoiceNo} · ${date(inv.date)} · ${inv.currency} ${money(inv.totalMinor, inv.currency)}`} />
      <div className="grid grid-cols-[1fr_340px] gap-4">
        <div>
          <Panel title="Lines" flush>
            <table className="tbl">
              <thead><tr><th>#</th><th>Part</th><th>Description</th><th>MPN</th><th>Origin</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount ({inv.currency})</th></tr></thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i}><td className="text-muted">{i + 1}</td><td className="id">{l.partId ?? "—"}</td><td>{l.description}</td><td className="id text-ink-2">{l.manufacturerPartNo ?? "—"}</td><td className="text-ink-2">{l.countryOfOrigin ?? "—"}</td><td className="num">{l.qty.toLocaleString("en-US")}</td><td className="num">{price(l.unitPriceE4)}</td><td className="num">{money(l.amountMinor, inv.currency)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={7}>Total</td><td className="num">{money(inv.totalMinor, inv.currency)}</td></tr></tfoot>
            </table>
          </Panel>
          <Panel title="Checks" flush>
            {findings.length === 0 ? <div className="p-3"><Pill tone="good">Matched</Pill> <span className="ml-2 text-ink-2">PO, receipt, packing slip, contract, certificate of origin and customs entry agree.</span></div> : (
              <table className="tbl">
                <thead><tr><th>Finding</th><th>Detail</th><th className="num">Amount (USD)</th><th>Disposition</th></tr></thead>
                <tbody>
                  {findings.map((f, i) => (
                    <tr key={i}><td className="whitespace-nowrap">{kindLabel(f.kind)}</td><td className="text-ink-2">{f.detail}{f.ruleId && <div className="mt-0.5 text-[11.5px] text-muted">Internal rule {f.ruleId}: {f.reason}</div>}</td><td className="num">{usd(f.impactUSDCents)}</td><td><Pill tone={dispositionTone(f.disposition)}>{dispositionLabel(f.disposition)}</Pill></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          {ce && (
            <Panel title={`Customs entry ${ce.id}`} flush note="Duty at USITC column-1 rates (retrieved Oct 23, 2026). Chapter 99 additional duties applied only from verified entries; MPF/HMF not modeled.">
              <table className="tbl">
                <thead><tr><th>Line</th><th>HTS entered</th><th>Origin</th><th className="num">Value (USD)</th><th className="num">Rate</th><th className="num">Duty (USD)</th></tr></thead>
                <tbody>{ce.lines.map((l) => <tr key={l.invoiceLineIndex}><td>{l.invoiceLineIndex + 1}</td><td className="id">{l.hts}</td><td>{l.countryOfOrigin}</td><td className="num">{usd(l.valueUSDCents)}</td><td className="num">{(l.dutyRateBp / 100).toFixed(2)}%</td><td className="num">{usd(l.dutyUSDCents)}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={5}>Duty + broker fee {usd(ce.brokerFeeUSDCents)}</td><td className="num">{usd(ce.totalUSDCents)}</td></tr></tfoot>
              </table>
            </Panel>
          )}
        </div>
        <div>
          <Panel title="Invoice">
            <Kv items={[["Supplier", vendor?.legalName ?? <span className="text-[var(--crit)]">{inv.supplierName} — not in vendor master</span>], ["Remit to (vendor master)", vendor ? `${vendor.remitTo.bankName} ····${vendor.remitTo.accountLast4}` : "—"], ["Currency", inv.currency], ["USD at invoice date", usd(toUsd(inv.totalMinor, inv.currency, inv.date), { symbol: true })], ["Source", <span key="s" className="id text-ink-2">{inv.sourceFile}</span>]]} />
          </Panel>
          <Panel title="Related records">
            <Kv items={[
              ["Purchase order", po ? <span key="po"><span className="id">{po.id}</span> · {date(po.date)}</span> : "None"],
              ["Contracts", <span key="c" className="flex flex-col">{contracts.map((c) => <span key={c.id}><span className="id">{c.id}</span> · {c.partId} · {c.prices[0].clauseRef}</span>)}</span>],
              ["Receipts", <span key="r" className="flex flex-col">{receipts.map((r) => <span key={r.id}><span className="id">{r.id}</span> · {date(r.date)} · {r.lines.map((l) => `${l.partId} ${l.qty.toLocaleString("en-US")}`).join(", ")}</span>)}</span>],
              ["Packing slips", <span key="s" className="flex flex-col">{slips.map((s) => <span key={s.id} className="id">{s.id}</span>)}</span>],
              ["Certificates of origin", certs.length ? <span key="o" className="flex flex-col">{certs.map((c) => <span key={c.id}><span className="id">{c.id}</span> · {c.partId} · {c.countryOfOrigin} · {c.manufacturer}</span>)}</span> : "None"],
            ]} />
          </Panel>
        </div>
      </div>
    </>
  );
}
