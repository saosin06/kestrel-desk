// Fetches the USITC HTS entries for every part (plus the codes our planted
// errors use and the Chapter 99 headings we research) and caches the raw
// responses. Re-runs read from data/cache/hts/ unless --refresh is passed.
//
//   npm run fetch:hts            # use cache where present
//   npm run fetch:hts -- --refresh

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import partsData from "../data/parts.json";
import { type HtsEntry, parseGeneralRate } from "../lib/costing/tariff";

const ROOT = join(import.meta.dirname, "..");
const CACHE = join(ROOT, "data/cache/hts");
const API = "https://hts.usitc.gov/reststop/search?keyword=";

/** Codes used by planted errors rather than by the part master. */
const EXTRA_CODES = ["7318.15.80"];
/** Chapter 99 headings under research for data/additional-duties.json. */
const CHAPTER_99 = ["9903.88.01", "9903.88.03", "9903.01.24", "9903.01.25", "9903.02.02"];

type ApiRow = { htsno: string; description: string | null; general: string; footnotes: { value?: string }[] | null };
type Cached = { url: string; retrievedAt: string; rows: ApiRow[] };

const refresh = process.argv.includes("--refresh");

async function fetchCode(code: string): Promise<Cached> {
  const file = join(CACHE, `${code}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Cached;
  const url = API + encodeURIComponent(code);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const cached: Cached = { url, retrievedAt: new Date().toISOString().slice(0, 10), rows: (await res.json()) as ApiRow[] };
  writeFileSync(file, JSON.stringify(cached, null, 2) + "\n");
  return cached;
}

const stripTags = (s: string | null) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** The 8-digit line, which the API sometimes returns as its 10-digit ".00" statistical line. */
function findRow(code: string, rows: ApiRow[]): ApiRow {
  const row = rows.find((r) => r.htsno === code) ?? rows.find((r) => r.htsno === `${code}.00`);
  if (!row) throw new Error(`USITC returned no row for ${code}`);
  if (!row.general) throw new Error(`USITC row ${row.htsno} has no general rate — check the parent heading by hand`);
  return row;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const codes = [...new Set([...partsData.parts.map((p) => p.hts), ...EXTRA_CODES])].sort();

  const entries: Record<string, HtsEntry> = {};
  for (const code of codes) {
    const c = await fetchCode(code);
    const row = findRow(code, c.rows);
    entries[code] = {
      htsno: code,
      description: stripTags(row.description),
      general: row.general,
      generalRateBp: parseGeneralRate(row.general),
      footnotes: (row.footnotes ?? []).map((f) => stripTags(f.value ?? "")).filter(Boolean),
      sourceUrl: c.url,
      retrievedAt: c.retrievedAt,
    };
    console.log(`${code.padEnd(12)} ${row.general.padEnd(6)} ${entries[code].description.slice(0, 60)}`);
  }
  writeFileSync(
    join(ROOT, "data/hts.json"),
    JSON.stringify({ source: "USITC Harmonized Tariff Schedule (hts.usitc.gov REST API)", entries }, null, 2) + "\n",
  );

  const ch99: Record<string, { heading: string; general: string; description: string; sourceUrl: string; retrievedAt: string }> = {};
  for (const h of CHAPTER_99) {
    const c = await fetchCode(h);
    const row = c.rows.find((r) => r.htsno === h);
    if (!row) throw new Error(`USITC returned no row for ${h}`);
    ch99[h] = { heading: h, general: row.general, description: stripTags(row.description), sourceUrl: c.url, retrievedAt: c.retrievedAt };
    console.log(`${h.padEnd(12)} ${row.general}`);
  }
  writeFileSync(
    join(ROOT, "data/cache/hts/chapter99.json"),
    JSON.stringify(
      {
        note: "Current-revision text of Chapter 99 headings, for research only. Rates are applied only via verified entries in data/additional-duties.json.",
        headings: ch99,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote data/hts.json (${codes.length} codes) and data/cache/hts/chapter99.json`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
