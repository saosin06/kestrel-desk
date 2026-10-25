import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InternalRule } from "@/lib/rules/types";
import { DEFAULT_SEED, generate } from "@/simulation/world";
import { score, scoreRows } from "./score";
import type { DeskState } from "./state";

const snap = JSON.parse(readFileSync(join(import.meta.dirname, "../../data/desk/agents-seed42.json"), "utf8")) as DeskState & { rules: InternalRule[] };

describe("scoreRows (the scorecard page)", () => {
  const w = generate(DEFAULT_SEED);
  const card = score(w, snap, snap.rules);
  const { rows, falseFindings } = scoreRows(w, snap, snap.rules);

  it("agrees with score() on what should escalate and what was caught", () => {
    const expected = rows.filter((r) => r.shouldEscalate);
    expect(expected.length).toBe(card.expected);
    expect(expected.filter((r) => r.caseId).length).toBe(card.caught);
    expect(falseFindings.length).toBe(card.falseFindings.length);
    expect(expected.reduce((a, r) => a + r.impactUSDCents, 0)).toBe(card.keyTotalUSDCents);
  });

  it("the saved agent run gets every row right", () => {
    expect(rows.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  });
});
