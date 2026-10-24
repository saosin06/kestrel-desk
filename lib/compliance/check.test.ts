import { describe, expect, it } from "vitest";
import policyData from "@/data/compliance-policy.json";
import type { BomLine, CompliancePolicy, CustomerType, Part, Product } from "@/lib/erp/types";
import { checkCompliance, type LotFacts } from "./check";

const policy = policyData as CompliancePolicy;

const P04: Part = {
  id: "P04",
  name: "Flight controller",
  hts: "8537.10.91",
  componentClass: "flight_controller",
  standardCostE4: 1_850_000,
  approvedSuppliers: ["S-VIR"],
  criticality: "critical",
};
const P14: Part = { ...P04, id: "P14", name: "Fastener kit", hts: "7318.15.60", componentClass: "fastener", criticality: "standard" };
const bomP04: BomLine = { productId: "K2", partId: "P04", qtyPer: 1, approvedMpn: "VFC-2" };
const K2: Product = { id: "K2", name: "Kestrel K2", customerTypes: ["federal", "state_local", "commercial"] };
const commercialOnly = (types: CustomerType[] = ["commercial"]): Product => ({ ...K2, customerTypes: types });

const check = (part: Part, facts: LotFacts, product: Product = K2, p: CompliancePolicy = policy, bomLine?: BomLine) =>
  checkCompliance({ part, facts, product, policy: p, bomLine });

describe("compliance check", () => {
  it("C1 covered class, US origin, federal product → pass", () => {
    const r = check(P04, { countryOfOrigin: "US", manufacturerPartNo: "VFC-2" }, K2, policy, bomP04);
    expect(r.status).toBe("pass");
    expect(r.substitution).toBe(false);
    expect(r.ruleRefs).toEqual(["KESTREL-UAS-1 §CP-1 (covered UAS components)"]);
  });

  it("C2 Vireo's substitute flight controller: restricted origin + MPN ≠ BOM → fail and substitution", () => {
    const r = check(P04, { countryOfOrigin: "CN", manufacturer: "Shenzhen OEM", manufacturerPartNo: "VFC-2-LC", certificateId: "COO-77" }, K2, policy, bomP04);
    expect(r.status).toBe("fail");
    expect(r.substitution).toBe(true);
    expect(r.reasons.join(" ")).toContain("origin CN is restricted for flight_controller");
    expect(r.reasons.join(" ")).toContain("VFC-2-LC ≠ BOM-approved VFC-2");
    expect(r.disclaimer).toContain("Not legal advice");
  });

  it("C3 restricted origin on an uncovered class (fasteners) → pass", () => {
    expect(check(P14, { countryOfOrigin: "CN" }).status).toBe("pass");
  });

  it("C4 covered and restricted, but product not sold to federal customers → not_applicable", () => {
    const r = check(P04, { countryOfOrigin: "CN" }, commercialOnly());
    expect(r.status).toBe("not_applicable");
  });

  it("C5 covered class with no certificate of origin → unknown, escalate", () => {
    const r = check(P04, { manufacturerPartNo: "VFC-2" }, K2, policy, bomP04);
    expect(r.status).toBe("unknown");
    expect(r.missing).toEqual(["certificateOfOrigin"]);
  });

  it("C6 restricted manufacturer category from a non-restricted country → fail", () => {
    const r = check(P04, { countryOfOrigin: "MY", manufacturer: "Offshore Sub", manufacturerCategories: ["covered_foreign_entity"] });
    expect(r.status).toBe("fail");
    expect(r.reasons.join(" ")).toContain('restricted category "covered_foreign_entity"');
  });

  it("C7 the policy is data: drop CN from it and the same lot passes", () => {
    const edited: CompliancePolicy = { ...policy, rules: policy.rules.map((r) => ({ ...r, restrictedOrigins: r.restrictedOrigins.filter((o) => o !== "CN") })) };
    expect(check(P04, { countryOfOrigin: "CN" }, K2, edited).status).toBe("pass");
  });

  it("flags a missing manufacturer part number when a BOM line is given", () => {
    expect(check(P04, { countryOfOrigin: "US" }, K2, policy, bomP04).missing).toEqual(["manufacturerPartNo"]);
  });
});
