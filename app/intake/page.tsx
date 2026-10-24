import { IntakeConsole, type IntakeOptions } from "@/components/intake-console";
import { PageHeader } from "@/components/ui";
import { formatUnitPrice } from "@/lib/money";
import { desk } from "@/lib/ui/world";

export const metadata = { title: "Live intake" };

const COVERED = new Set(["P04", "P09", "P10", "P11"]);

export default function IntakePage() {
  const { world } = desk();
  const suppliers = world.vendors.map((v) => {
    const s = world.pos.find((p) => p.supplierId === v.supplierId);
    return { id: v.supplierId, name: v.legalName, currency: (s?.currency ?? "USD") as "USD" | "JPY" | "EUR", country: v.supplierId === "S-ATL" ? "MX" : v.supplierId === "S-VIR" ? "TW" : v.supplierId === "S-HOS" ? "JP" : "US" };
  });
  const invoiceByPo = new Map(world.invoices.filter((i) => i.poId).map((i) => [i.poId!, i]));
  const options: IntakeOptions = {
    suppliers,
    pos: world.pos.map((p) => {
      const inv = invoiceByPo.get(p.id);
      return {
        id: p.id,
        supplierId: p.supplierId,
        date: p.date,
        lines: p.lines.map((l) => {
          const il = inv?.lines.find((x) => x.partId === l.partId);
          return { partId: l.partId, description: il?.description ?? l.partId, qty: String(l.qty), unitPrice: formatUnitPrice(l.unitPriceE4).replace(/0+$/, "").replace(/\.$/, ".00"), mpn: il?.manufacturerPartNo ?? "", covered: COVERED.has(l.partId) };
        }),
      };
    }),
  };
  return (
    <>
      <PageHeader
        title="Live intake"
        subtitle="Hand the desk a document. The deterministic checks answer instantly; the seat agent then works it live and its cases and requests appear on the desk. Documents go into a scratch copy of the company — the committed data never changes."
      />
      <IntakeConsole options={options} />
    </>
  );
}
