// Fetches ECB euro reference rates (via Frankfurter, EUR base — the rates as
// ECB publishes them) for the sim window and caches them. Re-runs use the
// cache unless --refresh is passed.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RateTable } from "../lib/costing/fx";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data/cache/fx/ecb-eur-reference.json");
const FROM = "2026-03-01";
const TO = "2026-10-23"; // last ECB fixing available when we fetched; later dates have no rate
const URL = `https://api.frankfurter.dev/v1/${FROM}..${TO}`;

type Response = { base: string; start_date: string; end_date: string; rates: Record<string, Record<string, number>> };

async function main() {
  if (existsSync(OUT) && !process.argv.includes("--refresh")) {
    console.log(`using cached ${OUT} (pass --refresh to refetch)`);
    return;
  }
  const res = await fetch(URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${URL} → HTTP ${res.status}`);
  const body = (await res.json()) as Response;
  if (body.base !== "EUR") throw new Error(`expected EUR base, got ${body.base}`);

  const days: Record<string, Record<string, string>> = {};
  for (const [date, rates] of Object.entries(body.rates)) {
    // String(n) is the shortest decimal that round-trips, i.e. the published figure.
    days[date] = Object.fromEntries(Object.entries(rates).map(([ccy, n]) => [ccy, String(n)]));
  }
  const dates = Object.keys(days).sort();
  const table: RateTable = {
    source: "ECB euro foreign exchange reference rates (via Frankfurter)",
    sourceUrl: URL,
    retrievedAt: new Date().toISOString().slice(0, 10),
    // ECB returns the last fixing on or before FROM, so the window starts there.
    from: dates[0] < FROM ? dates[0] : FROM,
    to: TO,
    days,
  };
  mkdirSync(join(ROOT, "data/cache/fx"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(table, null, 2) + "\n");
  console.log(`wrote ${dates.length} ECB business days ${dates[0]}..${dates.at(-1)} → ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
