import { Suspense } from "react";
import { CaseDetail } from "@/components/case-detail";

export default function CasePage() {
  return (
    <Suspense>
      <CaseDetail />
    </Suspense>
  );
}
