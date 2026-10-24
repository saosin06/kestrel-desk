// Landed cost of an import invoice, and a line-by-line check of the broker's
// customs entry. Goods are valued in USD at the ECB rate on the invoice date —
// a simplification (CBP uses the date of exportation). Duty is assessed on
// invoice value, which assumes FOB/FCA terms. MPF/HMF are not modeled.

import type { CalcStep, CertificateOfOrigin, CustomsEntry, Invoice, Part, Supplier } from "@/lib/erp/types";
import { allocate, divRound, pctOf } from "@/lib/money";
import { convert, type RateTable } from "./fx";
import {
  type AdditionalDutyEntry,
  additionalDutyStep,
  generalRateStep,
  type HtsTable,
  htsEntry,
  resolveAdditionalDuties,
} from "./tariff";

export const DUTY_ROUNDING_TOLERANCE_CENTS = 1;
export const VALUE_ROUNDING_TOLERANCE_CENTS = 1;

export type LandedCostInput = {
  invoice: Invoice;
  supplier: Supplier;
  parts: Readonly<Record<string, Part>>;
  hts: HtsTable;
  additionalDuties: readonly AdditionalDutyEntry[];
  fx: RateTable;
  freightUSDCents: number;
  brokerFeeUSDCents: number;
  /** Certificates of origin for this invoice; the system of record for origin. */
  certificates?: readonly CertificateOfOrigin[];
};

export type OriginSource = "certificate_of_origin" | "invoice_line" | "supplier_country";

export type LandedLine = {
  lineIndex: number;
  partId: string;
  qty: number;
  hts: string;
  origin: string;
  originSource: OriginSource;
  /** set when the certificate and the invoice line name different origins */
  originConflict?: string;
  goodsUSDCents: number;
  generalDutyCents: number;
  additionalDutyCents: number;
  dutyCents: number;
  unverifiedAdditionalDuty: boolean;
  additionalDutyNote: string;
  freightCents: number;
  brokerFeeCents: number;
  landedCents: number;
  steps: CalcStep[];
};

export type LandedCost = {
  invoiceId: string;
  lines: LandedLine[];
  goodsUSDCents: number;
  dutyCents: number;
  freightUSDCents: number;
  brokerFeeUSDCents: number;
  landedCents: number;
  anyUnverifiedAdditionalDuty: boolean;
};

export function landedCost(input: LandedCostInput): LandedCost {
  const { invoice, supplier, parts, hts, additionalDuties, fx } = input;

  const base = invoice.lines.map((line, lineIndex) => {
    if (!line.partId) throw new Error(`invoice ${invoice.id} line ${lineIndex + 1} has no part id; match it first`);
    const part = parts[line.partId];
    if (!part) throw new Error(`unknown part ${line.partId} on invoice ${invoice.id}`);
    const conv = convert(fx, line.amountMinor, invoice.currency, "USD", invoice.date);
    // Precedence: certificate of origin → invoice line → supplier country.
    const coo = input.certificates?.find((c) => c.invoiceId === invoice.id && c.partId === part.id);
    const origin = coo?.countryOfOrigin ?? line.countryOfOrigin ?? supplier.country;
    const originSource: OriginSource = coo ? "certificate_of_origin" : line.countryOfOrigin ? "invoice_line" : "supplier_country";
    const originConflict =
      coo && line.countryOfOrigin && coo.countryOfOrigin !== line.countryOfOrigin
        ? `certificate ${coo.id} says ${coo.countryOfOrigin}, invoice line says ${line.countryOfOrigin}`
        : undefined;
    return { line, lineIndex, part, conv, origin, originSource, originConflict };
  });

  const goods = base.map((b) => b.conv.amountMinor);
  const freight = allocate(input.freightUSDCents, goods);
  const broker = allocate(input.brokerFeeUSDCents, goods);

  const lines: LandedLine[] = base.map((b, i) => {
    const steps: CalcStep[] = [b.conv.step];
    let generalDutyCents = 0;
    let additionalDutyCents = 0;
    let unverified = false;
    let note = "domestic origin";

    if (b.origin !== "US") {
      const entry = htsEntry(hts, b.part.hts);
      generalDutyCents = pctOf(goods[i], entry.generalRateBp);
      steps.push(generalRateStep(entry, goods[i], generalDutyCents));

      const extra = resolveAdditionalDuties(additionalDuties, b.origin, b.part.hts, invoice.date);
      unverified = extra.unverified;
      note = extra.reason;
      for (const h of extra.applied) {
        const d = pctOf(goods[i], h.rateBp);
        additionalDutyCents += d;
        steps.push(additionalDutyStep(h, goods[i], d));
      }
    }

    const dutyCents = generalDutyCents + additionalDutyCents;
    const landedCents = goods[i] + dutyCents + freight[i] + broker[i];
    steps.push({
      label: "Landed cost = goods + duty + allocated freight + allocated broker fee (by value)",
      inputs: { goodsUSDCents: goods[i], dutyCents, freightCents: freight[i], brokerFeeCents: broker[i] },
      result: landedCents,
      ruleRef: "Landed cost policy (value-based allocation)",
    });

    return {
      lineIndex: b.lineIndex,
      partId: b.part.id,
      qty: b.line.qty,
      hts: b.part.hts,
      origin: b.origin,
      originSource: b.originSource,
      originConflict: b.originConflict,
      goodsUSDCents: goods[i],
      generalDutyCents,
      additionalDutyCents,
      dutyCents,
      unverifiedAdditionalDuty: unverified,
      additionalDutyNote: note,
      freightCents: freight[i],
      brokerFeeCents: broker[i],
      landedCents,
      steps,
    };
  });

  const sum = (f: (l: LandedLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  return {
    invoiceId: invoice.id,
    lines,
    goodsUSDCents: sum((l) => l.goodsUSDCents),
    dutyCents: sum((l) => l.dutyCents),
    freightUSDCents: input.freightUSDCents,
    brokerFeeUSDCents: input.brokerFeeUSDCents,
    landedCents: sum((l) => l.landedCents),
    anyUnverifiedAdditionalDuty: lines.some((l) => l.unverifiedAdditionalDuty),
  };
}

/** Unit landed cost in ten-thousandths, for inventory valuation. */
export function landedPerUnitE4(line: LandedLine): number {
  if (line.qty <= 0) throw new Error(`line ${line.lineIndex + 1} has no quantity`);
  // cents → ten-thousandths of a dollar is ×100
  return Number(divRound(BigInt(line.landedCents) * 100n, BigInt(line.qty)));
}

export type CustomsLineCheck = {
  lineIndex: number;
  partId: string;
  enteredHts: string;
  expectedHts: string;
  chargedDutyCents: number;
  expectedDutyCents: number;
  /** charged − expected */
  deltaCents: number;
  /** broker's declared value − our invoice value in USD */
  valueDeltaCents: number;
  kind: "ok" | "duty_overcharge" | "source_disagreement";
  note: string;
  steps: CalcStep[];
};

export type CustomsCheck = {
  customsEntryId: string;
  lines: CustomsLineCheck[];
  overchargeCents: number;
  needsEscalation: boolean;
};

/**
 * The customs entry is the system of record for duty charged. Each line's gap
 * against our expected duty (on the entry's own declared value) is either
 * explained by a wrong HTS code, or it is a source disagreement to escalate.
 */
export function compareToCustoms(
  landed: LandedCost,
  entry: CustomsEntry,
  parts: Readonly<Record<string, Part>>,
  hts: HtsTable,
  additionalDuties: readonly AdditionalDutyEntry[],
  invoiceDate: string,
): CustomsCheck {
  const lines: CustomsLineCheck[] = entry.lines.map((el) => {
    const ll = landed.lines.find((l) => l.lineIndex === el.invoiceLineIndex);
    if (!ll) throw new Error(`customs entry ${entry.id} cites invoice line ${el.invoiceLineIndex + 1}, not on ${landed.invoiceId}`);
    const part = parts[ll.partId];
    const expectedEntry = htsEntry(hts, part.hts);

    const steps: CalcStep[] = [];
    let expectedDutyCents = pctOf(el.valueUSDCents, expectedEntry.generalRateBp);
    steps.push(generalRateStep(expectedEntry, el.valueUSDCents, expectedDutyCents));
    const extra = resolveAdditionalDuties(additionalDuties, ll.origin, part.hts, invoiceDate);
    for (const h of extra.applied) {
      const d = pctOf(el.valueUSDCents, h.rateBp);
      expectedDutyCents += d;
      steps.push(additionalDutyStep(h, el.valueUSDCents, d));
    }

    const deltaCents = el.dutyUSDCents - expectedDutyCents;
    const valueDeltaCents = el.valueUSDCents - ll.goodsUSDCents;
    const valueOff = Math.abs(valueDeltaCents) > VALUE_ROUNDING_TOLERANCE_CENTS;
    const valueNote = `declared value ${el.valueUSDCents}¢ ≠ invoice value ${ll.goodsUSDCents}¢ at the invoice-date rate`;
    const base = {
      lineIndex: el.invoiceLineIndex,
      partId: ll.partId,
      enteredHts: el.hts,
      expectedHts: part.hts,
      chargedDutyCents: el.dutyUSDCents,
      expectedDutyCents,
      deltaCents,
      valueDeltaCents,
      steps,
    };

    if (Math.abs(deltaCents) <= DUTY_ROUNDING_TOLERANCE_CENTS) {
      if (valueOff) return { ...base, kind: "source_disagreement" as const, note: valueNote };
      return { ...base, kind: "ok" as const, note: "duty charged matches expected" };
    }
    if (el.hts !== part.hts && deltaCents > 0) {
      steps.push({
        label: `Classification: entered ${el.hts}, expected ${part.hts}`,
        inputs: {
          enteredHts: el.hts,
          enteredRateBp: el.dutyRateBp,
          expectedHts: part.hts,
          expectedRateBp: expectedEntry.generalRateBp,
          basis: part.htsBasis ?? "part master HTS",
        },
        result: deltaCents,
        ruleRef: `USITC HTS ${part.hts}: ${expectedEntry.description}`,
      });
      const note = `broker entered ${el.hts} instead of ${part.hts}`;
      return { ...base, kind: "duty_overcharge" as const, note: valueOff ? `${note}; also ${valueNote}` : note };
    }
    const why =
      el.hts !== part.hts
        ? `entered ${el.hts} instead of ${part.hts} and charged less than expected — possible duty underpayment`
        : extra.unverified
          ? `gap not explained by column 1; ${extra.reason}`
          : "gap not explained by column 1 or verified Chapter 99 duties";
    return { ...base, kind: "source_disagreement" as const, note: valueOff ? `${why}; also ${valueNote}` : why };
  });

  return {
    customsEntryId: entry.id,
    lines,
    overchargeCents: lines.filter((l) => l.kind === "duty_overcharge").reduce((a, l) => a + l.deltaCents, 0),
    needsEscalation: lines.some((l) => l.kind === "source_disagreement"),
  };
}
