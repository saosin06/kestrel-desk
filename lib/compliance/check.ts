// Evaluates a received/invoiced part against the configurable CompliancePolicy.
// The policy is data (data/compliance-policy.json); nothing here encodes a
// legal claim. Missing facts produce "unknown" (escalate), never a pass.

import type { BomLine, CompliancePolicy, Part, Product } from "@/lib/erp/types";

export type LotFacts = {
  /** from the certificate of origin (system of record for origin claims) */
  countryOfOrigin?: string;
  certificateId?: string;
  manufacturer?: string;
  manufacturerPartNo?: string;
  manufacturerCategories?: string[];
};

export type ComplianceInput = {
  part: Part;
  bomLine?: BomLine;
  facts: LotFacts;
  product: Product;
  policy: CompliancePolicy;
};

export type ComplianceStatus = "pass" | "fail" | "unknown" | "not_applicable";

export type ComplianceResult = {
  status: ComplianceStatus;
  ruleRefs: string[];
  reasons: string[];
  missing: string[];
  /** manufacturer part number differs from the engineering-approved BOM part */
  substitution: boolean;
  policyId: string;
  disclaimer: string;
};

export function checkCompliance({ part, bomLine, facts, product, policy }: ComplianceInput): ComplianceResult {
  const reasons: string[] = [];
  const missing: string[] = [];

  let substitution = false;
  if (bomLine) {
    if (!facts.manufacturerPartNo) missing.push("manufacturerPartNo");
    else if (facts.manufacturerPartNo !== bomLine.approvedMpn) {
      substitution = true;
      reasons.push(`manufacturer part no. ${facts.manufacturerPartNo} ≠ BOM-approved ${bomLine.approvedMpn}`);
    }
  }

  const result = (status: ComplianceStatus, ruleRefs: string[]): ComplianceResult => ({
    status,
    ruleRefs,
    reasons,
    missing,
    substitution,
    policyId: policy.id,
    disclaimer: policy.disclaimer,
  });

  const sellsToCovered = product.customerTypes.some((t) => policy.appliesToCustomerTypes.includes(t));
  if (!sellsToCovered) {
    reasons.push(`${product.id} is not sold to ${policy.appliesToCustomerTypes.join("/")} customers`);
    return result("not_applicable", []);
  }

  const rules = policy.rules.filter((r) => r.componentClasses.includes(part.componentClass));
  if (rules.length === 0) {
    reasons.push(`component class "${part.componentClass}" is not covered by ${policy.id}`);
    return result("pass", []);
  }
  const applicable = rules.map((r) => r.ruleRef);

  if (!facts.countryOfOrigin) {
    missing.push("certificateOfOrigin");
    reasons.push(`no certificate of origin for covered component ${part.id}`);
    return result("unknown", applicable);
  }

  const violated = rules.filter((r) => {
    const hits: string[] = [];
    if (r.restrictedOrigins.includes(facts.countryOfOrigin!)) {
      hits.push(`origin ${facts.countryOfOrigin} is restricted for ${part.componentClass}`);
    }
    for (const cat of facts.manufacturerCategories ?? []) {
      if (r.restrictedManufacturerCategories.includes(cat)) {
        hits.push(`manufacturer ${facts.manufacturer ?? "(unnamed)"} is in restricted category "${cat}"`);
      }
    }
    for (const h of hits) reasons.push(`${h} (${r.ruleRef})`);
    return hits.length > 0;
  });

  if (violated.length > 0) return result("fail", violated.map((r) => r.ruleRef));
  return result("pass", applicable);
}
