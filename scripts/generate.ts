// Writes the simulated world and answer key to data/.
//   npm run generate              # seed 42 (committed)
//   npm run generate -- --seed 11 # a second world (different hidden rules), to show the desk isn't overfit

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SEED, generate, serializeWorld } from "../simulation/world";

const ROOT = join(import.meta.dirname, "..");
const i = process.argv.indexOf("--seed");
const seed = i >= 0 ? Number(process.argv[i + 1]) : DEFAULT_SEED;
if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");

const world = generate(seed);
for (const [path, content] of Object.entries(serializeWorld(world))) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), content);
}
const k = world.answerKey;
console.log(
  `seed ${seed}: ${world.pos.length} POs, ${world.invoices.length} invoices, ${world.customsEntries.length} customs entries, ` +
    `${world.certificates.length} certificates; ${k.entries.length} answer-key entries (problems ${[...new Set(k.entries.map((e) => e.problem))].join(", ")})`,
);
