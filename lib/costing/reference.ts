// Cached external reference data (USITC HTS, ECB FX) and our Chapter 99 table.
// Produced by scripts/fetch-hts.ts and scripts/fetch-fx.ts; works offline.

import additionalDutiesData from "@/data/additional-duties.json";
import fxData from "@/data/cache/fx/ecb-eur-reference.json";
import htsData from "@/data/hts.json";
import type { RateTable } from "./fx";
import type { AdditionalDutyEntry, HtsTable } from "./tariff";

export function loadHtsTable(): HtsTable {
  return htsData.entries;
}

export function loadEcbRates(): RateTable {
  return fxData;
}

export function loadAdditionalDuties(): AdditionalDutyEntry[] {
  return additionalDutiesData.entries as AdditionalDutyEntry[];
}
