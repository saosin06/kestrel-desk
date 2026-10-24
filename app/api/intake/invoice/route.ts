import { after } from "next/server";
import { api } from "@/convex/_generated/api";
import { UNREGISTERED_SUPPLIER } from "@/lib/erp/types";
import type { CertificateOfOrigin, Invoice, InvoiceLine } from "@/lib/erp/types";
import { checkNow, convex, currentRules, overlay, runSeatAndCommit } from "@/lib/live/desk";
import type { InvoiceForm } from "@/lib/live/forms";
import { isCurrency, lineAmount, parseUnitPrice } from "@/lib/money";

const COVERED: Record<string, string> = { P04: "flight_controller", P09: "radio_datalink", P10: "camera", P11: "gimbal" };

export async function POST(req: Request) {
  let form: InvoiceForm;
  try {
    form = (await req.json()) as InvoiceForm;
    if (!isCurrency(form.currency)) throw new Error(`unsupported currency ${form.currency}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) throw new Error("date must be YYYY-MM-DD");
    if (!form.invoiceNo.trim()) throw new Error("invoice number is required");
    if (form.lines.length === 0) throw new Error("add at least one line");
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }

  const client = convex();
  const n = await client.query(api.intake.nextId, {});
  const intakeId = `INTAKE-${n}`;
  const invoiceId = `VI-${intakeId}`;

  let lines: InvoiceLine[];
  try {
    lines = form.lines.map((l, i) => {
      const qty = Number(l.qty);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`line ${i + 1}: quantity must be a whole number`);
      const unitPriceE4 = parseUnitPrice(l.unitPrice);
      return {
        ...(l.partId ? { partId: l.partId } : {}),
        description: l.description || l.partId || "item",
        qty,
        unitPriceE4,
        amountMinor: lineAmount(qty, unitPriceE4, form.currency), // engine, never the browser
        ...(l.countryOfOrigin ? { countryOfOrigin: l.countryOfOrigin.toUpperCase() } : {}),
        ...(l.manufacturerPartNo ? { manufacturerPartNo: l.manufacturerPartNo } : {}),
      };
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "bad line" }, { status: 400 });
  }

  const invoice: Invoice = {
    id: invoiceId,
    invoiceNo: form.invoiceNo.trim(),
    supplierId: form.supplierId || UNREGISTERED_SUPPLIER,
    supplierName: form.supplierName,
    ...(form.poId ? { poId: form.poId } : {}),
    date: form.date,
    currency: form.currency,
    lines,
    totalMinor: lines.reduce((a, l) => a + l.amountMinor, 0),
    sourceFile: `live-intake:${intakeId}`,
    simulated: true,
  };
  const certificates: CertificateOfOrigin[] = form.lines
    .filter((l) => l.partId && COVERED[l.partId] && l.certificateOrigin)
    .map((l) => ({ id: `COO-${intakeId}-${l.partId}`, invoiceId, partId: l.partId, manufacturer: `${form.supplierName} (as certified)`, manufacturerPartNo: l.manufacturerPartNo || undefined, countryOfOrigin: l.certificateOrigin.toUpperCase(), sourceFile: `live-intake:${intakeId}` }));

  const rules = await currentRules(client);
  const world = overlay({ invoice, certificates, mode: form.mode });
  const findings = checkNow(world, invoiceId, rules);
  const title = `Invoice ${invoice.invoiceNo} from ${form.supplierName}${form.poId ? ` on ${form.poId}` : ""}`;
  await client.mutation(api.intake.create, { intakeId, kind: "invoice", at: form.date, title, doc: { invoice, certificates, mode: form.mode }, findings, seat: "ap_clerk" });

  after(() =>
    runSeatAndCommit({
      intakeId,
      seat: "ap_clerk",
      world,
      today: form.date,
      rules,
      task: `Today is ${form.date}. A supplier invoice just arrived: ${invoiceId} (${title}). Check it and act on it as the controls require — hold, escalate, or request payment. Handle only this invoice.`,
    }),
  );
  return Response.json({ intakeId, invoiceId, findings });
}
